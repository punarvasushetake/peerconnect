const { supabase } = require('../config/supabase');
const { ApiError } = require('../utils/apiError');
const { MISTRAL_API_KEY, MISTRAL_API_URL, MISTRAL_MODEL } = require('../config/mistral');
const {
  searchSemanticDocuments,
  recommendPeersSemantic,
  generateQuizFromSemantic,
  askRagQuestion,
} = require('../services/semantic.service');

/**
 * Helper: call Mistral chat completions API.
 */
const callMistral = async (systemPrompt, userMessage, options = {}) => {
  if (!MISTRAL_API_KEY) {
    throw new ApiError(503, 'Mistral API key is not configured');
  }

  const response = await fetch(MISTRAL_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: MISTRAL_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: options.temperature ?? 0.35,
      max_tokens: options.maxTokens ?? 2048,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new ApiError(502, `Mistral API error: ${errBody}`);
  }

  const result = await response.json();
  return result.choices[0].message.content;
};

const stripHtml = (value = '') =>
  String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const tokenize = (value = '') =>
  stripHtml(value)
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/i)
    .filter((token) => token.length > 1);

const buildArticleText = (article) =>
  [
    article.title,
    article.category,
    Array.isArray(article.tags) ? article.tags.join(' ') : '',
    stripHtml(article.content || ''),
  ]
    .filter(Boolean)
    .join('\n');

const scoreArticle = (article, query) => {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return 0;

  const title = stripHtml(article.title || '').toLowerCase();
  const category = String(article.category || '').toLowerCase();
  const tags = Array.isArray(article.tags) ? article.tags.join(' ').toLowerCase() : '';
  const content = stripHtml(article.content || '').toLowerCase();

  let score = 0;
  for (const token of queryTokens) {
    if (title.includes(token)) score += 6;
    if (tags.includes(token)) score += 4;
    if (category.includes(token)) score += 3;
    if (content.includes(token)) score += 1;
  }

  const phrase = stripHtml(query).toLowerCase();
  if (phrase && title.includes(phrase)) score += 10;
  if (phrase && content.includes(phrase)) score += 4;

  return score;
};

const makeSnippet = (content = '', query = '', maxLength = 260) => {
  const text = stripHtml(content);
  if (text.length <= maxLength) return text;

  const firstToken = tokenize(query)[0];
  const matchIndex = firstToken ? text.toLowerCase().indexOf(firstToken) : -1;
  const start = Math.max(0, matchIndex > -1 ? matchIndex - 80 : 0);
  const snippet = text.slice(start, start + maxLength).trim();
  return `${start > 0 ? '...' : ''}${snippet}${start + maxLength < text.length ? '...' : ''}`;
};

const getRankedArticles = async (query, limit = 8) => {
  const { data: articles, error } = await supabase
    .from('articles')
    .select('id, title, content, category, tags, created_at')
    .order('created_at', { ascending: false })
    .limit(120);

  if (error) throw new ApiError(400, error.message);

  return (articles || [])
    .map((article) => ({
      ...article,
      snippet: makeSnippet(article.content || '', query),
      relevance_score: scoreArticle(article, query),
    }))
    .filter((article) => article.relevance_score > 0)
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, limit);
};

const getRepositoryArticles = async (limit = 80) => {
  const { data: articles, error } = await supabase
    .from('articles')
    .select('id, title, content, category, tags, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new ApiError(400, error.message);

  return (articles || []).map((article) => ({
    ...article,
    content: stripHtml(article.content || ''),
  }));
};

const logAIUsage = async ({ userId, actionType, promptSummary, latencyMs }) => {
  try {
    await supabase.from('ai_logs').insert({
      user_id: userId || null,
      action_type: actionType,
      prompt_summary: promptSummary || null,
      model: MISTRAL_MODEL,
      latency_ms: Number.isFinite(latencyMs) ? latencyMs : null,
    });
  } catch {
    // Keep AI endpoint resilient even if logging fails.
  }
};

/**
 * Summarize content using Mistral.
 */
const summarize = async (req, res) => {
  try {
    const { content } = req.body;
    const startedAt = Date.now();

    if (!content) {
      throw new ApiError(400, 'Content is required');
    }

    const summary = await callMistral(
      `You create clean study summaries.
Format every answer exactly like this:
Overview:
- one short sentence

Key Points:
- 3 to 5 concise bullets

Action Items:
- 1 to 3 practical next steps, or "- None" if not applicable

Use plain text only. Do not invent facts that are not in the source.`,
      `Summarize this content:\n\n${content}`,
      { temperature: 0.2, maxTokens: 900 }
    );

    await logAIUsage({
      userId: req.user?.id,
      actionType: 'summary',
      promptSummary: content.slice(0, 500),
      latencyMs: Date.now() - startedAt,
    });

    res.json({
      success: true,
      data: { summary },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Generate quiz questions from content using Mistral, store in quizzes table.
 */
const generateQuiz = async (req, res) => {
  try {
    const userId = req.user.id;
    const { content, title, source_type, source_id } = req.body;
    const startedAt = Date.now();

    if (!content || !title) {
      throw new ApiError(400, 'Content and title are required');
    }

    let questions;
    let aiActionType = 'quiz';

    const semanticQuiz = await generateQuizFromSemantic(content, title, 5);
    if (semanticQuiz?.questions?.length) {
      questions = semanticQuiz.questions;
      aiActionType = 'quiz-semantic';
    } else {
      const quizResponse = await callMistral(
        `You are a quiz generator. Create exactly 5 multiple-choice questions based on the provided content. 
Return a valid JSON array of objects with this exact structure:
[
  {
    "question": "the question text",
    "options": ["option A", "option B", "option C", "option D"],
    "correct_answer": 0
  }
]
Where correct_answer is the zero-based index of the correct option. Return ONLY the JSON array, no other text.`,
        `Generate quiz questions based on this content:\n\n${content}`
      );

      try {
        const jsonMatch = quizResponse.match(/\[[\s\S]*\]/);
        questions = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(quizResponse);
      } catch {
        throw new ApiError(502, 'Failed to parse quiz questions from AI response');
      }
    }

    // Store quiz in database
    const { data: quiz, error } = await supabase
      .from('quizzes')
      .insert({
        title,
        questions,
        source_type: source_type || null,
        source_id: source_id || null,
        created_by: userId,
      })
      .select()
      .single();

    if (error) throw new ApiError(400, error.message);

    await logAIUsage({
      userId,
      actionType: aiActionType,
      promptSummary: `${title}: ${content.slice(0, 350)}`,
      latencyMs: Date.now() - startedAt,
    });

    res.status(201).json({
      success: true,
      data: quiz,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Intelligent search: searches articles via full-text, then uses Mistral to re-rank and explain.
 */
const intelligentSearch = async (req, res) => {
  try {
    const { query } = req.body;
    const startedAt = Date.now();

    if (!query) {
      throw new ApiError(400, 'Query is required');
    }

    const articles = await getRankedArticles(query, 10);

    if (articles.length === 0) {
      return res.json({
        success: true,
        data: {
          results: [],
          answer: '',
          explanation: 'No repository resources matched your query. Try broader words or add more content.',
        },
      });
    }

    const semanticRanking = await searchSemanticDocuments(
      query,
      articles.map((article) => ({
        id: article.id,
        text: buildArticleText(article).slice(0, 900),
      }))
    );

    let rankedArticles = articles;
    if (semanticRanking?.ranked?.length) {
      const articleById = new Map(articles.map((article) => [String(article.id), article]));
      rankedArticles = semanticRanking.ranked
        .map((row) => articleById.get(String(row.id)))
        .filter(Boolean);

      const includedIds = new Set(rankedArticles.map((item) => String(item.id)));
      for (const article of articles) {
        if (!includedIds.has(String(article.id))) {
          rankedArticles.push(article);
        }
      }
    }

    const articlesContext = rankedArticles
      .slice(0, 5)
      .map((a, i) => `[${i + 1}] ${a.title}\nCategory: ${a.category || 'uncategorized'}\nSnippet: ${a.snippet}`)
      .join('\n\n');

    let answer = '';
    let explanation = semanticRanking?.ranked?.length
      ? `Ranked using repository content plus semantic relevance (${semanticRanking.model || 'semantic service'}).`
      : 'Ranked using title, tags, category, and resource content.';
    try {
      answer = await callMistral(
        `You answer repository search queries using only the provided results.
Return:
Answer:
- 2 to 4 bullets that directly answer the query

Best Matches:
- mention the most useful resource titles

If the results are weak, say that clearly.`,
        `Query: ${query}\n\nRepository results:\n${articlesContext}`,
        { temperature: 0.25, maxTokens: 700 }
      );
    } catch {
      answer = `I found ${rankedArticles.length} matching resource${rankedArticles.length === 1 ? '' : 's'} for "${query}". Open the best matches below for details.`;
    }

    res.json({
      success: true,
      data: {
        results: rankedArticles,
        answer,
        explanation,
      },
    });

    await logAIUsage({
      userId: req.user?.id,
      actionType: semanticRanking?.ranked?.length ? 'search-semantic' : 'search',
      promptSummary: query.slice(0, 500),
      latencyMs: Date.now() - startedAt,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Get personalized recommendations: find users teaching skills the current user is learning.
 */
const getRecommendations = async (req, res) => {
  try {
    const userId = req.user.id;
    const startedAt = Date.now();

    // Get the current user's learning skills
    const { data: learningSkills, error: lsError } = await supabase
      .from('user_skills')
      .select('skill_id, skills(name)')
      .eq('user_id', userId)
      .eq('is_learning', true);

    if (lsError) throw new ApiError(400, lsError.message);

    if (!learningSkills || learningSkills.length === 0) {
      return res.json({
        success: true,
        data: {
          recommendations: [],
          message: 'Add some skills you want to learn to get recommendations.',
        },
      });
    }

    const skillIds = learningSkills.map((s) => s.skill_id);

    // Find users teaching those skills
    const { data: teachers, error: tError } = await supabase
      .from('user_skills')
      .select('*, skills(name, category), profiles(id, full_name, avatar_url, headline)')
      .in('skill_id', skillIds)
      .eq('is_teaching', true)
      .neq('user_id', userId);

    if (tError) throw new ApiError(400, tError.message);

    // Group by user to avoid duplicates
    const userMap = new Map();
    for (const t of teachers) {
      const uid = t.profiles?.id;
      if (!uid) continue;
      if (!userMap.has(uid)) {
        userMap.set(uid, {
          user: t.profiles,
          teaching_skills: [],
        });
      }
      userMap.get(uid).teaching_skills.push({
        skill_name: t.skills?.name,
        proficiency_level: t.proficiency_level,
      });
    }

    const recommendations = Array.from(userMap.values());
    const learningSkillNames = learningSkills
      .map((item) => item.skills?.name)
      .filter(Boolean);

    const semanticPeerRanking = await recommendPeersSemantic(
      learningSkillNames,
      recommendations.map((item) => ({
        id: item.user?.id,
        text: `${item.user?.headline || ''}\n${item.teaching_skills.map((s) => s.skill_name).join(', ')}`,
      }))
    );

    let rankedRecommendations = recommendations;
    if (semanticPeerRanking?.ranked?.length) {
      const recById = new Map(recommendations.map((item) => [String(item.user?.id), item]));
      rankedRecommendations = semanticPeerRanking.ranked
        .map((row) => recById.get(String(row.id)))
        .filter(Boolean);

      const includedIds = new Set(rankedRecommendations.map((item) => String(item.user?.id)));
      for (const rec of recommendations) {
        if (!includedIds.has(String(rec.user?.id))) {
          rankedRecommendations.push(rec);
        }
      }
    }

    await logAIUsage({
      userId,
      actionType: semanticPeerRanking?.ranked?.length ? 'recommend-peer-semantic' : 'recommend-peer',
      promptSummary: `learning_skills_count=${learningSkills.length}`,
      latencyMs: Date.now() - startedAt,
    });

    res.json({
      success: true,
      data: {
        recommendations: rankedRecommendations,
        learning_skills: learningSkills.map((s) => s.skills?.name),
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Ask a question over repository resources using Haystack-backed retrieval.
 */
const askRepository = async (req, res) => {
  try {
    const { question } = req.body || {};
    const startedAt = Date.now();

    if (!question || !String(question).trim()) {
      throw new ApiError(400, 'question is required');
    }

    const repositoryArticles = await getRepositoryArticles(80);

    if (repositoryArticles.length === 0) {
      return res.json({
        success: true,
        data: {
          answer: `The knowledge base does not have any repository resources yet. Add resources first, then ask this question again.`,
          contexts: [],
          model: 'empty-repository',
          provider: 'fallback',
        },
      });
    }

    const allDocs = repositoryArticles.map((article) => ({
      id: article.id,
      title: article.title,
      text: buildArticleText(article).slice(0, 1400),
      category: article.category || null,
      tags: article.tags || [],
    }));

    const ragResponse = await askRagQuestion(question, allDocs);

    if (ragResponse) {
      await logAIUsage({
        userId: req.user?.id,
        actionType: 'rag-answer',
        promptSummary: String(question).slice(0, 500),
        latencyMs: Date.now() - startedAt,
      });

      return res.json({
        success: true,
        data: ragResponse,
      });
    }

    const rankedArticles = repositoryArticles
      .map((article) => ({
        ...article,
        snippet: makeSnippet(article.content || '', question),
        relevance_score: scoreArticle(article, question),
      }))
      .sort((a, b) => b.relevance_score - a.relevance_score);

    const bestArticles = rankedArticles.some((item) => item.relevance_score > 0)
      ? rankedArticles.filter((item) => item.relevance_score > 0).slice(0, 6)
      : repositoryArticles.slice(0, 6).map((article) => ({
          ...article,
          snippet: makeSnippet(article.content || '', question),
          relevance_score: 0,
        }));

    const snippets = bestArticles.map((item) => ({
      id: item.id,
      title: item.title,
      snippet: item.snippet,
      score: item.relevance_score,
    }));

    const contextText = snippets
      .map((item, index) => `[${index + 1}] ${item.title}\n${item.snippet}`)
      .join('\n\n');

    let fallbackAnswer;
    try {
      fallbackAnswer = await callMistral(
        `You are a grounded knowledge-base assistant.
Your job is to be useful even when the retrieved context is partial.
Answer only from the provided contexts. Do not invent details.
If the exact answer is missing, explain what the available resources do say and what information is still missing.
Format:
Direct Answer:
- give the clearest answer possible

Details From Knowledge Base:
- include useful specifics from the retrieved resources

Missing / Unclear:
- mention gaps only if needed

Sources Used:
- cite source titles`,
        `Question: ${question}\n\nContexts:\n${contextText}`,
        { temperature: 0.2, maxTokens: 1200 }
      );
    } catch {
      fallbackAnswer = `I found related repository content for "${question}", but the AI answer service is unavailable. Review the retrieved contexts below.`;
    }

    await logAIUsage({
      userId: req.user?.id,
      actionType: 'rag-fallback',
      promptSummary: String(question).slice(0, 500),
      latencyMs: Date.now() - startedAt,
    });

    return res.json({
      success: true,
      data: {
        answer: fallbackAnswer,
        contexts: snippets,
        model: MISTRAL_API_KEY ? MISTRAL_MODEL : 'local-retrieval',
        provider: MISTRAL_API_KEY ? 'mistral-grounded-fallback' : 'fallback',
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports = {
  summarize,
  generateQuiz,
  intelligentSearch,
  getRecommendations,
  askRepository,
};
