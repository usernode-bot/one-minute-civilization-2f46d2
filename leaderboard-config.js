// Daily Derby Leaderboard settings. Prize amounts live here and nowhere
// else: the server attaches them to each ranked row and the page renders
// whatever the API sends.
module.exports = {
  // HR paid to ranks 1 to 5, in order (index 0 is rank 1).
  DAILY_PRIZES_HR: [0.1, 0.07, 0.05, 0.03, 0.02],
  // How many verified entries the board lists.
  LEADERBOARD_SIZE: 10,
  // How often the page re-fetches the board while visible.
  POLL_MS: 30000,
};
