const fs = require("fs");
const path = require("path");

const KNOWLEDGE_FILE = path.join(
  process.cwd(),
  "data",
  "DJP_Level1_MASTER_TrainingData_FINAL.txt"
);

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "before",
  "by",
  "can",
  "do",
  "does",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "many",
  "me",
  "my",
  "of",
  "on",
  "or",
  "should",
  "tell",
  "that",
  "the",
  "their",
  "there",
  "these",
  "this",
  "to",
  "us",
  "was",
  "we",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you",
  "your",
]);

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token && token.length > 1 && !STOP_WORDS.has(token));
}

function buildBigrams(tokens) {
  const bigrams = [];

  for (let index = 0; index < tokens.length - 1; index += 1) {
    bigrams.push(`${tokens[index]} ${tokens[index + 1]}`);
  }

  return bigrams;
}

function parsePageRange(line) {
  const match = line.match(/\((Pages?|Page)\s+([^)]+)\)/i);

  if (!match) {
    return null;
  }

  return match[2].trim();
}

function stripPageRange(line) {
  return line
    .replace(/\s*\((Pages?|Page)\s+[^)]+\)/i, "")
    .replace(/^---\s*|\s*---$/g, "")
    .trim();
}

function finalizeEntry(entries, entry, chapter, section) {
  if (!entry?.question || !entry?.answer) {
    return;
  }

  const question = entry.question.trim();
  const answer = entry.answer.trim();
  const questionTokens = tokenize(question);
  const answerTokens = tokenize(answer);
  const metadataText = [chapter?.title, chapter?.pages, section].filter(Boolean).join(" ");
  const metadataTokens = tokenize(metadataText);

  entries.push({
    id: `kb-${entries.length + 1}`,
    question,
    answer,
    chapterTitle: chapter?.title || null,
    chapterPages: chapter?.pages || null,
    section: section || null,
    questionNormalized: normalizeText(question),
    questionTokens,
    questionTokenSet: new Set(questionTokens),
    answerTokenSet: new Set(answerTokens),
    metadataTokenSet: new Set(metadataTokens),
  });
}

function parseKnowledgeFile(fileContents) {
  const lines = fileContents.split(/\r?\n/);
  const entries = [];
  let currentChapter = null;
  let currentSection = null;
  let currentEntry = null;
  let currentField = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed || /^=+$/.test(trimmed)) {
      continue;
    }

    if (trimmed.startsWith("--- CHAPTER")) {
      finalizeEntry(entries, currentEntry, currentChapter, currentSection);
      currentEntry = null;
      currentField = null;

      currentChapter = {
        title: stripPageRange(trimmed),
        pages: parsePageRange(trimmed),
      };
      currentSection = null;
      continue;
    }

    if (trimmed.startsWith("--- SECTION:")) {
      finalizeEntry(entries, currentEntry, currentChapter, currentSection);
      currentEntry = null;
      currentField = null;

      currentSection = trimmed
        .replace(/^--- SECTION:\s*/i, "")
        .replace(/\s*---$/g, "")
        .trim();
      continue;
    }

    if (trimmed.startsWith("Q:")) {
      finalizeEntry(entries, currentEntry, currentChapter, currentSection);
      currentEntry = {
        question: trimmed.slice(2).trim(),
        answer: "",
      };
      currentField = "question";
      continue;
    }

    if (trimmed.startsWith("A:")) {
      if (!currentEntry) {
        continue;
      }

      currentEntry.answer = trimmed.slice(2).trim();
      currentField = "answer";
      continue;
    }

    if (!currentEntry || !currentField) {
      continue;
    }

    currentEntry[currentField] = `${currentEntry[currentField]}\n${trimmed}`.trim();
  }

  finalizeEntry(entries, currentEntry, currentChapter, currentSection);
  return entries;
}

function loadKnowledgeBase() {
  if (!fs.existsSync(KNOWLEDGE_FILE)) {
    return {
      filePath: KNOWLEDGE_FILE,
      entries: [],
      loaded: false,
      error: `Knowledge file not found at ${KNOWLEDGE_FILE}`,
    };
  }

  const fileContents = fs.readFileSync(KNOWLEDGE_FILE, "utf8");
  const entries = parseKnowledgeFile(fileContents);

  return {
    filePath: KNOWLEDGE_FILE,
    entries,
    loaded: true,
    error: null,
  };
}

function scoreEntry(entry, query) {
  const normalizedQuery = normalizeText(query);
  const queryTokens = tokenize(query);

  if (!normalizedQuery || queryTokens.length === 0) {
    return 0;
  }

  let score = 0;

  if (entry.questionNormalized === normalizedQuery) {
    score += 120;
  }

  if (entry.questionNormalized.includes(normalizedQuery)) {
    score += 50;
  }

  if (normalizedQuery.includes(entry.questionNormalized)) {
    score += 35;
  }

  for (const token of queryTokens) {
    if (entry.questionTokenSet.has(token)) {
      score += 10;
    } else if (entry.answerTokenSet.has(token)) {
      score += 4;
    } else if (entry.metadataTokenSet.has(token)) {
      score += 3;
    }
  }

  const entryQuestionBigrams = new Set(buildBigrams(entry.questionTokens));
  const queryBigrams = buildBigrams(queryTokens);

  for (const bigram of queryBigrams) {
    if (entryQuestionBigrams.has(bigram)) {
      score += 12;
    }
  }

  if (entry.chapterTitle && normalizedQuery.includes(normalizeText(entry.chapterTitle))) {
    score += 12;
  }

  if (entry.section && normalizedQuery.includes(normalizeText(entry.section))) {
    score += 8;
  }

  return score;
}

function retrieveKnowledgeEntries(knowledgeBase, query, maxResults = 5) {
  if (!knowledgeBase?.entries?.length) {
    return [];
  }

  return knowledgeBase.entries
    .map((entry) => ({
      ...entry,
      score: scoreEntry(entry, query),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, maxResults);
}

function formatReference(entry) {
  return [entry.chapterTitle, entry.chapterPages, entry.section]
    .filter(Boolean)
    .join(" | ");
}

function buildKnowledgeContext(entries) {
  return entries
    .map((entry, index) => {
      const lines = [
        `Source ${index + 1}`,
        `Reference: ${formatReference(entry) || "General textbook content"}`,
        `Question: ${entry.question}`,
        `Answer: ${entry.answer}`,
      ];

      return lines.join("\n");
    })
    .join("\n\n");
}

function buildReferencePayload(entries) {
  return entries.map((entry) => ({
    id: entry.id,
    label: formatReference(entry) || "General textbook content",
    question: entry.question,
    score: entry.score,
  }));
}

module.exports = {
  buildKnowledgeContext,
  buildReferencePayload,
  loadKnowledgeBase,
  retrieveKnowledgeEntries,
};
