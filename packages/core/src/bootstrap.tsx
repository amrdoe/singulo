import React from 'react';
import { createRoot } from 'react-dom/client';

export function bootstrap(modules: Record<string, any>) {
    const rootElement = document.getElementById('root');
    if (!rootElement) throw new Error("Root element not found");

    const root = createRoot(rootElement);

    // Simple Router Logic
    const currentPath = window.location.pathname;
    let MatchedComponent: React.ComponentType | null = null;

    for (const path in modules) {
        const mod = modules[path];
        const config = mod.config || {};
        const route = config.route;

        // Basic exact match for now
        // TODO: Support params and regex based on path-to-regexp if needed
        if (route === currentPath) {
            MatchedComponent = mod.default;
            break;
        }

        // Support basic wildcard/regex if config.route is a RegExp (it won't be from JSON, but in JS it could)
        // Or if it is a string pattern?
        // For this MVP, exact match is fine as per "home /" verification.
    }

    if (MatchedComponent) {
        root.render(<MatchedComponent />);
    } else {
        root.render(<div>
            <h1>404 - Page Not Found</h1>
            <p>No route matched {currentPath}</p>
        </div>);
    }
}
