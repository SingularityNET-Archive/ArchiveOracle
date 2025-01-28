// netlify/functions/batchUpdateMeetingSummariesById.js
import { supabase } from '../../lib/supabaseClient';
import { Octokit } from "@octokit/rest";

const BATCH_SIZE = 100;
const MAX_CONCURRENT_REQUESTS = 10;

function sanitizeObject(item) {
  if (typeof item === 'string') {
    // Replace line breaks with spaces
    // Only replace en dash (U+2013) or em dash (U+2014) with ASCII hyphen '-'
    // Replace curly single quotes ’ and ‘ with straight ASCII apostrophe '
    // Replace curly double quotes ” and “ with straight ASCII quote "
    return item
      .replace(/\r?\n/g, ' ')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .trim();
  } 
  
  if (Array.isArray(item)) {
    return item.map(element => sanitizeObject(element));
  }
  
  if (item && typeof item === 'object') {
    const newObj = {};
    for (const key in item) {
      newObj[key] = sanitizeObject(item[key]);
    }
    return newObj;
  }

  // for numbers, booleans, null, etc just return item.
  return item;
}


async function fetchMeetingSummaries(lastProcessedTimestamp, batchNumber) {
  const { data: summaries, error } = await supabase
    .from('meetingsummaries')
    .select('created_at, meeting_id, summary')
    .eq('confirmed', true)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)
    .gt('created_at', lastProcessedTimestamp || '1970-01-01')
    .range(batchNumber * BATCH_SIZE, (batchNumber + 1) * BATCH_SIZE - 1);

  if (error) {
    throw new Error('Failed to retrieve meeting summaries');
  }
  return summaries;
}

function groupSummariesByMeetingId(summaries, allSummaries) {
  summaries.forEach(summary => {
    const { meeting_id, summary: summaryText } = summary;
    const year = new Date(summaryText.meetingInfo.date).getFullYear();

    // Make sure the buckets exist
    if (!allSummaries[year]) {
      allSummaries[year] = {};
    }
    if (!allSummaries[year][meeting_id]) {
      allSummaries[year][meeting_id] = [];
    }

    // Sanitize the entire summary object (assuming summaryText could be an object)
    const sanitizedSummary = sanitizeObject(summaryText);

    allSummaries[year][meeting_id].push(sanitizedSummary);
  });
}


async function commitSummariesToGitHub(allSummaries) {
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  for (const year in allSummaries) {
    const yearSummaries = allSummaries[year];
    const path = `Data/Snet-Ambassador-Program/Meeting-Summaries/${year}/meeting-summaries-by-id.json`;

    let currentSHA = null;
    try {
      const { data: currentFile } = await octokit.repos.getContent({
        owner: "SingularityNET-Archive",
        repo: "SingularityNET-Archive",
        path,
      });
      currentSHA = currentFile.sha;
    } catch (error) {
      if (error.status !== 404) {
        throw error;
      }
    }

    await octokit.repos.createOrUpdateFileContents({
      owner: "SingularityNET-Archive",
      repo: "SingularityNET-Archive",
      path,
      message: `Update meeting summaries for ${year}`,
      content: Buffer.from(JSON.stringify(yearSummaries, null, 2)).toString('base64'),
      sha: currentSHA,
    });
  }
}

async function processAndCommitSummaries() {
  const allSummaries = {};
  let lastProcessedTimestamp = null;
  let hasMoreSummaries = true;
  let batchNumber = 0;

  while (hasMoreSummaries) {
    const fetchPromises = [];

    for (let i = 0; i < MAX_CONCURRENT_REQUESTS; i++) {
      fetchPromises.push(fetchMeetingSummaries(lastProcessedTimestamp, batchNumber));
      batchNumber++;
    }

    const summariesBatches = await Promise.all(fetchPromises);
    const flattenedSummaries = summariesBatches.flat();

    if (flattenedSummaries.length === 0) {
      hasMoreSummaries = false;
      break;
    }

    flattenedSummaries.forEach(summary => {
      groupSummariesByMeetingId([summary], allSummaries);
    });

    lastProcessedTimestamp = flattenedSummaries[flattenedSummaries.length - 1].created_at;
  }

  await commitSummariesToGitHub(allSummaries);
}

export const handler = async (event, context) => {
  try {
    await processAndCommitSummaries();

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Meeting summaries updated successfully' }),
    };
  } catch (error) {
    console.error('Error in updateGitHubRepo function:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to update meeting summaries' }),
    };
  }
};