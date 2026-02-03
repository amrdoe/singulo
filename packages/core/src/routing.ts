/**
 * File-based routing utilities for Singulo
 * Supports Next.js-style routing conventions:
 * - Static routes: pages/about.singulo.tsx → /about
 * - Dynamic routes: pages/blog/[slug].singulo.tsx → /blog/:slug
 * - Optional parameters: pages/[[slug]].singulo.tsx → / or /:slug
 * - Catch-all: pages/blog/[...slug].singulo.tsx → /blog/*
 * - Optional catch-all: pages/[[...slug]].singulo.tsx → / or /*
 */

export interface RoutePattern {
    filePath: string;
    pattern: string;
    regex: RegExp;
    keys: string[];
    priority: number;
}

/**
 * Converts a file path to a route pattern
 * @param filePath - The file path relative to pages directory (e.g., "./pages/blog/[slug].singulo.tsx")
 * @returns Route pattern with regex and parameter keys
 */
export function filePathToRoute(filePath: string): RoutePattern {
    // Remove leading ./ and trailing .singulo.tsx
    let path = filePath.replace(/^\.\//, '').replace(/\.singulo\.tsx$/, '');
    
    // Remove 'pages/' prefix if present
    path = path.replace(/^pages\//, '');
    
    // Handle index files - they map to the parent directory
    path = path.replace(/\/index$/, '').replace(/^index$/, '');
    
    // Start building the route pattern
    let pattern = '/' + path;
    const keys: string[] = [];
    
    // Handle optional parameters: [[slug]] (single param, not catch-all)
    // Must check this before optional catch-all [[...slug]]
    const optionalParamMatch = pattern.match(/\/\[\[(\w+)\]\]/);
    if (optionalParamMatch && !pattern.includes('[[...')) {
        const paramName = optionalParamMatch[1];
        keys.push(paramName);
        
        // Remove the optional param to see what's left
        const basePath = pattern.replace(/\/\[\[(\w+)\]\]/, '');
        
        // Build regex based on whether there's a base path
        let regex: RegExp;
        
        if (!basePath || basePath === '/') {
            // Optional param is the entire route (e.g., /[[slug]])
            // Should match both "/" and "/:slug"
            regex = new RegExp(`^/(?:([^/]+))?$`);
            pattern = '/:' + paramName + '?';
        } else {
            // Optional param is part of a longer route (e.g., /user/[[id]])
            // Should match "/user" and "/user/:id"
            const escapedBase = escapeRegex(basePath);
            regex = new RegExp(`^${escapedBase}(?:/([^/]+))?$`);
            pattern = basePath + '/:' + paramName + '?';
        }
        
        return {
            filePath,
            pattern,
            regex,
            keys,
            priority: calculatePriority(pattern, true, false, false, true)
        };
    }
    
    // Handle optional catch-all: [[...slug]]
    const optionalCatchAllMatch = pattern.match(/\/\[\[\.\.\.(\w+)\]\]/);
    if (optionalCatchAllMatch) {
        const paramName = optionalCatchAllMatch[1];
        keys.push(paramName);
        // Remove the [[...param]] part and make it optional
        pattern = pattern.replace(/\/\[\[\.\.\.(\w+)\]\]/, '');
        if (!pattern) pattern = '/';
        
        // Create regex that matches both with and without the catch-all part
        const escapedPattern = escapeRegex(pattern);
        const regex = new RegExp(`^${escapedPattern}(?:/(.*))?$`);
        
        return {
            filePath,
            pattern: pattern + '/*?',
            regex,
            keys,
            priority: calculatePriority(pattern, true, false, true, false)
        };
    }
    
    // Handle catch-all: [...slug]
    const catchAllMatch = pattern.match(/\/\[\.\.\.(\w+)\]/);
    if (catchAllMatch) {
        const paramName = catchAllMatch[1];
        keys.push(paramName);
        pattern = pattern.replace(/\/\[\.\.\.(\w+)\]/, '');
        
        const escapedPattern = escapeRegex(pattern);
        const regex = new RegExp(`^${escapedPattern}/(.+)$`);
        
        return {
            filePath,
            pattern: pattern + '/*',
            regex,
            keys,
            priority: calculatePriority(pattern, true, true, false, false)
        };
    }
    
    
    // Handle dynamic parameters: [slug] (required parameters only)
    const dynamicSegments = pattern.match(/\[(\w+)\]/g);
    if (dynamicSegments) {
        for (const segment of dynamicSegments) {
            const paramName = segment.slice(1, -1); // Remove [ and ]
            keys.push(paramName);
            pattern = pattern.replace(segment, `:${paramName}`);
        }
        
        // Build regex for the pattern
        let regexPattern = escapeRegex(pattern);
        
        // Replace :param with capture groups
        for (const key of keys) {
            regexPattern = regexPattern.replace(`:${key}`, '([^/]+)');
        }
        
        const regex = new RegExp(`^${regexPattern}$`);
        
        return {
            filePath,
            pattern,
            regex,
            keys,
            priority: calculatePriority(pattern, true, false, false, false)
        };
    }
    
    // Static route (no parameters)
    const regex = new RegExp(`^${escapeRegex(pattern)}$`);
    
    return {
        filePath,
        pattern,
        regex,
        keys,
        priority: calculatePriority(pattern, false, false, false, false)
    };
}

/**
 * Matches a pathname against a route pattern and extracts parameters
 * @param routePattern - The route pattern to match against
 * @param pathname - The URL pathname to match
 * @returns Match result with extracted parameters
 */
export function matchRoute(
    routePattern: RoutePattern,
    pathname: string
): { match: boolean; params: Record<string, string | string[]> } {
    const match = routePattern.regex.exec(pathname);
    
    if (!match) {
        return { match: false, params: {} };
    }
    
    const params: Record<string, string | string[]> = {};
    
    // Extract parameters
    for (let i = 0; i < routePattern.keys.length; i++) {
        const key = routePattern.keys[i];
        const value = match[i + 1];
        
        // Check if this is a catch-all or optional catch-all
        if (routePattern.pattern.includes('/*')) {
            // Split by / for catch-all parameters
            params[key] = value ? value.split('/').filter(Boolean) : [];
        } else {
            params[key] = value || '';
        }
    }
    
    return { match: true, params };
}

/**
 * Calculates priority for route ordering
 * Higher priority routes are matched first
 */
function calculatePriority(
    pattern: string,
    hasDynamic: boolean,
    isCatchAll: boolean,
    isOptionalCatchAll: boolean,
    hasOptional: boolean = false
): number {
    // Static routes have highest priority
    if (!hasDynamic && !isCatchAll && !isOptionalCatchAll) {
        const segments = pattern.split('/').filter(Boolean);
        // More segments = higher priority (more specific)
        return 1000 + segments.length;
    }
    
    // Dynamic routes have medium priority
    if (hasDynamic && !isCatchAll && !isOptionalCatchAll) {
        const segments = pattern.split('/').filter(Boolean);
        const dynamicCount = segments.filter(s => s.startsWith(':')).length;
        const staticCount = segments.length - dynamicCount;
        
        // Optional params have lower priority than required params
        let basePriority = 500 + staticCount * 10 - dynamicCount;
        if (hasOptional) {
            basePriority -= 50;
        }
        
        return basePriority;
    }
    
    // Catch-all routes have lower priority
    if (isCatchAll) {
        const segments = pattern.split('/').filter(Boolean);
        return 100 + segments.length;
    }
    
    // Optional catch-all has lowest priority
    return 50;
}

/**
 * Escapes special regex characters in a string
 */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
