module.exports = {
    apps: [
        {
            name: "snake-sepolia",
            script: "./server.js",
            cwd: "/home/snake/snake-agents",
            env: { ENV_FILE: ".env.sepolia" }
        },
        {
            name: "snake-mainnet",
            script: "./server.js",
            cwd: "/home/snake/snake-agents",
            env: { ENV_FILE: ".env.mainnet" }
        }
    ]
};
