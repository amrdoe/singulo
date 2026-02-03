import React from 'react';
import { createRoot } from 'react-dom/client';
import { filePathToRoute, matchRoute, RoutePattern } from './routing';
import { globalContext } from './index';

export function bootstrap(modules: Record<string, any>) {
    const rootElement = document.getElementById('root');
    if (!rootElement) throw new Error("Root element not found");

    const root = createRoot(rootElement);

    const currentPath = window.location.pathname;
    let MatchedComponent: React.ComponentType | null = null;
    let routeParams: Record<string, string | string[]> = {};

    console.log('[Bootstrap] Starting bootstrap with modules:', modules);
    console.log('[Bootstrap] Current path:', currentPath);

    // Build route patterns for all modules
    const routes: Array<{ pattern: RoutePattern; module: any }> = [];

    for (const filePath in modules) {
        const mod = modules[filePath];
        const config = mod.config || {};

        // Use explicit route from config, or derive from file path
        let routePattern: RoutePattern;

        if (config.route !== undefined) {
            // Manual route specified - treat it as a static route
            const pattern = config.route;
            console.log('[Bootstrap] Using explicit route:', pattern, 'for', filePath);

            routePattern = {
                filePath,
                pattern,
                regex: new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
                keys: [],
                priority: 1000
            };
        } else {
            // Derive route from file path
            routePattern = filePathToRoute(filePath);
            console.log('[Bootstrap] Derived route:', routePattern.pattern, 'from', filePath);
        }

        routes.push({ pattern: routePattern, module: mod });
    }

    // Sort routes by priority (higher priority first)
    routes.sort((a, b) => b.pattern.priority - a.pattern.priority);

    console.log('[Bootstrap] Route priority order:', routes.map(r => ({
        pattern: r.pattern.pattern,
        priority: r.pattern.priority
    })));

    // Match current path against routes
    for (const { pattern, module } of routes) {
        const result = matchRoute(pattern, currentPath);
        console.log('[Bootstrap] Testing route:', pattern.pattern, '→', result.match ? 'MATCH' : 'no match');

        if (result.match) {
            console.log('[Bootstrap] Found matching route!', 'Params:', result.params);
            MatchedComponent = module.default;
            routeParams = result.params;

            // Set params in global context for server-side access pattern compatibility
            // Note: This is primarily for consistency; on client side, params should be passed as props
            if (globalContext.current) {
                globalContext.current.params = routeParams;
            }

            break;
        }
    }

    if (MatchedComponent) {
        console.log('[Bootstrap] Rendering matched component');
        // Pass route params as props to the component
        root.render(<MatchedComponent {...routeParams} />);
    } else {
        console.log('[Bootstrap] No route matched, showing 404');
        root.render(<div>
            <h1>404 - Page Not Found</h1>
            <p>No route matched {currentPath}</p>
        </div>);
    }
}
