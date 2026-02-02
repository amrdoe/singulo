import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import rpcHandler from './dist/server/rpc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const args = process.argv.slice(2);

// Parse arguments
let requestedPort = parseInt(process.env.PORT || '3000', 10);
const portArgIdx = args.findIndex(a => a === '--port' || a.startsWith('--port='));
if (portArgIdx !== -1) {
    const val = args[portArgIdx];
    requestedPort = parseInt(val.includes('=') ? val.split('=')[1] : args[portArgIdx + 1], 10);
}
const force = args.includes('--force');
import { execSync } from 'child_process';

// Serve static files
app.use(express.static(path.join(__dirname, 'dist')));

// Serve RPC
app.all(/^\/_singulo\/rpc/, (req, res) => {
    rpcHandler(req, res);
});

// Fallback to index.html for SPA routing
app.get(/(.*)/, (req, res) => {
    res.sendFile(path.join(__dirname, 'dist/index.html'));
});

const startServer = (port) => {
    const server = app.listen(port, () => {
        console.log(`Production server running at http://localhost:${port}`);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            if (force && port === requestedPort) {
                console.log(`Port ${port} is in use. --force flag detected. Attempting to kill process...`);
                try {
                     // Try fuser first (common on linux), fallback to lsof
                    try {
                        execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' });
                    } catch {
                         const pid = execSync(`lsof -t -i:${port}`).toString().trim();
                         if (pid) process.kill(parseInt(pid, 10), 'SIGKILL');
                    }
                    console.log(`Process on port ${port} killed. Retrying...`);
                    // Wait a moment for OS to release port
                    setTimeout(() => startServer(port), 500);
                } catch (killErr) {
                    console.error(`Failed to release port ${port}:`, killErr.message);
                    process.exit(1);
                }
            } else {
                console.log(`Port ${port} is in use. Trying ${port + 1}...`);
                startServer(port + 1);
            }
        } else {
            console.error("Server error:", err);
        }
    });
};

startServer(requestedPort);
