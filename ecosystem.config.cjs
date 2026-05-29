module.exports = {
  apps: [
    {
      name: "local-image-hub",
      script: "dist/server.cjs",
      args: "start",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};