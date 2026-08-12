module.exports = {
  fetch: async (url) => {
    // Simple mock for DexScreener batch fetch – return empty data for any URL
    return {
      ok: true,
      status: 200,
      json: async () => ({ pairs: [] })
    };
  }
};
