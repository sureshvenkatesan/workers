import { PlatformContext, ScheduledEventRequest, ScheduledEventResponse, SyncConfig, SyncResult } from './types';


// Logging utility
const log = {
  info: (message: string, ...args: any[]) => console.log('[INFO] ' + message, ...args),
  warn: (message: string, ...args: any[]) => console.warn('[WARN] ' + message, ...args),
  error: (message: string, ...args: any[]) => console.error('[ERROR] ' + message, ...args),
  debug: (message: string, ...args: any[]) => console.log('[DEBUG] ' + message, ...args)
};

// Configuration parsing utility
function getProperty(context: PlatformContext, key: string, defaultValue: string = ''): string {
  try {
    const ctx = context as any;
    return String(
      ctx.properties?.get?.(key) || 
      ctx.properties?.[key] || 
      ctx.workerConfig?.properties?.[key] || 
      ctx.config?.properties?.[key] || 
      defaultValue
    );
  } catch {
    return defaultValue;
  }
}

// Parse JSON string safely
function parseJsonString(jsonStr: string): any {
  if (!jsonStr?.trim()) return {};
  try {
    return JSON.parse(jsonStr);
  } catch {
    return {};
  }
}

// Parse paths from semicolon-separated string
function parsePathsArg(pathsArg?: string): string[] {
  if (!pathsArg) return [];
  return pathsArg
    .split(';')
    .map(p => p.trim().replace(/^\/+/, ''))
    .filter(p => p.length > 0);
}

// Remove duplicates while preserving order
function uniqueKeepOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}

// Build sync endpoint for Artifact Sync Download API
function buildSyncEndpoint(repoKey: string, artifactPath: string, progress: boolean = true): string {
  const endpoint = '/artifactory/api/download/' + repoKey + '/' + artifactPath;
  const params = ['content=none'];
  if (progress) {
    params.push('progress=1');
  }
  return endpoint + '?' + params.join('&');
}

// Pull a single artifact
async function pullOne(
  context: PlatformContext,
  repoKey: string,
  artifactPath: string,
  progress: boolean,
  dryRun: boolean
): Promise<boolean> {
  const endpoint = buildSyncEndpoint(repoKey, artifactPath, progress);
  
  if (dryRun) {
    log.info('[DRY-RUN] Would call: ' + endpoint);
    log.info('[DRY-RUN] Artifact path: ' + artifactPath);
    return true;
  }

  try {
    const response = await context.clients.platformHttp.get(endpoint);
    const success = response.status === 200;
    
    if (success) {
      if (progress && response.data) {
        log.info('[OK] ' + artifactPath + ' :: ' + response.data);
      } else {
        log.info('[OK] ' + artifactPath + ' :: sync triggered');
      }
    } else {
      log.error('[ERR] ' + artifactPath + ' :: status=' + response.status);
    }
    
    return success;
  } catch (error: any) {
    log.error('[ERR] ' + artifactPath + ' :: ' + error.message);
    return false;
  }
}

// Pull files in parallel
async function pullFilesParallel(
  context: PlatformContext,
  repoKey: string,
  paths: string[],
  progress: boolean,
  dryRun: boolean,
  maxWorkers: number = 5
): Promise<{ successCount: number; failureCount: number }> {
  let successCount = 0;
  let failureCount = 0;
  
  log.info('Starting parallel execution with ' + maxWorkers + ' workers for ' + paths.length + ' files...');
  
  // Process files in batches to avoid overwhelming the system
  const batchSize = Math.min(maxWorkers, 3); // Limit batch size for better performance
  for (let i = 0; i < paths.length; i += batchSize) {
    const batch = paths.slice(i, i + batchSize);
    const promises = batch.map(path => 
      pullOne(context, repoKey, path, progress, dryRun)
        .then(success => ({ path, success }))
        .catch(error => ({ path, success: false, error }))
    );
    
    const results = await Promise.all(promises);
    
    for (const result of results) {
      if (result.success) {
        successCount++;
      } else {
        failureCount++;
        if ('error' in result) {
          log.error('Failed to process ' + result.path + ': ' + result.error);
        }
      }
    }
    
    // Small delay between batches to be respectful to the system
    if (i + batchSize < paths.length) {
      await context.wait(100);
    }
  }
  
  return { successCount, failureCount };
}

// Discover files from upstream URL using external HTTP calls
async function discoverFilesFromUpstream(
  context: PlatformContext,
  upstreamUrl: string,
  directoryPath: string
): Promise<string[]> {
  try {
    log.info('Discovering files from upstream: ' + upstreamUrl + '/' + directoryPath);
    
    // Build the full URL for the directory listing
    const fullUrl = upstreamUrl.replace(/\/+$/, '') + '/' + directoryPath.replace(/^\/+/, '').replace(/\/+$/, '') + '/';
    
    log.debug('Making HTTP request to: ' + fullUrl);
    
    // Make external HTTP call using axios client
    const response = await context.clients.axios.get(fullUrl, {
      headers: {
        'User-Agent': 'JFrog-Worker/1.0'
      }
    });
    
    if (response.status === 200) {
      const html = response.data;
      const discoveredFiles: string[] = [];
      
      // Parse HTML response to find file links
      // This is a simple regex approach - may need refinement for different servers
      const filePattern = /href="([^"]+)"/g;
      let match;
      const subdirectories: string[] = [];
      
      while ((match = filePattern.exec(html)) !== null) {
        const href = match[1];
        
        // Skip parent directory links and common non-file entries
        if (href === '../' || href === './' || href === '' || href === '/') {
          continue;
        }
        
        // Remove leading slash from href if present
        const cleanHref = href.replace(/^\/+/, '');
        
        if (href.endsWith('/')) {
          // This is a subdirectory
          if (cleanHref && cleanHref !== directoryPath.replace(/\/+$/, '') && !cleanHref.includes('..')) {
            // Remove the directory path prefix if it's already included in the href
            let subdirName = cleanHref.replace(/\/+$/, '');
            const dirName = directoryPath.replace(/\/+$/, '');
            if (subdirName.startsWith(dirName + '/')) {
              subdirName = subdirName.substring(dirName.length + 1);
            }
            if (subdirName && subdirName !== dirName) {
              subdirectories.push(subdirName);
            }
          }
        } else {
          // This is a file - check if it looks like a common artifact file
          const commonExtensions = ['.jar', '.pom', '.war', '.ear', '.aar', '.zip', '.tar.gz', '.tgz', '.md5', '.sha1', '.sha256', '.sha512', '.asc'];
          if (commonExtensions.some(ext => cleanHref.endsWith(ext)) || cleanHref.includes('.')) {
            // Construct the full path, but avoid duplication
            let fullPath = cleanHref;
            const dirName = directoryPath.replace(/\/+$/, '');
            if (!fullPath.startsWith(dirName + '/')) {
              fullPath = directoryPath.replace(/\/+$/, '') + '/' + cleanHref;
            }
            discoveredFiles.push(fullPath);
          }
        }
      }
      
      // Recursively discover files in subdirectories (limited depth to avoid infinite recursion)
      log.debug('Found subdirectories: ' + JSON.stringify(subdirectories));
      for (const subdir of subdirectories.slice(0, 5)) { // Limit to 5 subdirectories
        try {
          // Don't recurse into subdirectories that would create duplicate paths
          if (subdir !== directoryPath.replace(/\/+$/, '')) {
            const subdirPath = directoryPath.replace(/\/+$/, '') + '/' + subdir;
            log.debug('Recursively discovering subdirectory: ' + subdirPath);
            const subdirFiles = await discoverFilesFromUpstream(context, upstreamUrl, subdirPath);
            discoveredFiles.push(...subdirFiles);
          }
        } catch (subdirError: any) {
          log.warn('Failed to discover files in subdirectory ' + subdir + ': ' + subdirError.message);
        }
      }
      
      if (discoveredFiles.length > 0) {
        log.info('Discovered ' + discoveredFiles.length + ' files from ' + fullUrl);
        return discoveredFiles;
      } else {
        log.warn('No files found in ' + fullUrl);
        return [];
      }
    } else {
      log.warn('Could not access upstream URL: HTTP ' + response.status);
      return [];
    }
  } catch (error: any) {
    log.error('Error discovering files from upstream: ' + error.message);
    if (error.response) {
      log.error('HTTP Error: ' + error.response.status + ' - ' + error.response.statusText);
    }
    return [];
  }
}

// Check if a file is already cached in the cache repository
async function isFileCached(
  context: PlatformContext,
  repoKey: string,
  filePath: string
): Promise<boolean> {
  try {
    // The cache repository is typically named {repoKey}-cache
    const cacheRepoName = repoKey + '-cache';
    
    // Use the Artifactory API to check if the file exists in the cache repository
    const response = await context.clients.platformHttp.get('/artifactory/api/storage/' + cacheRepoName + '/' + filePath);
    return response.status === 200;
  } catch (error: any) {
    // If we get a 404 or other error, the file is not cached
    return false;
  }
}

// Filter files based on delta sync setting
async function filterDeltaFiles(
  context: PlatformContext,
  repoKey: string,
  filePaths: string[],
  onlyDelta: boolean
): Promise<string[]> {
  const startTime = Date.now();
  if (!onlyDelta) {
    log.info('Delta sync disabled - will sync all ' + filePaths.length + ' files');
    return filePaths;
  }
  
  const cacheRepoName = repoKey + '-cache';
  log.info('Delta sync enabled - checking cache status for ' + filePaths.length + ' files in cache repository: ' + cacheRepoName);
  const uncachedFiles: string[] = [];
  let cachedCount = 0;
  
  // Check files in batches to avoid overwhelming the API
  const batchSize = 5;
  const maxUncachedFiles = 50; // Limit to prevent timeout
  
  for (let i = 0; i < filePaths.length; i += batchSize) {
    // Check execution time limit (30 seconds max for cache checking)
    const elapsed = Date.now() - startTime;
    if (elapsed > 30000) {
      log.warn('Cache check timeout reached (' + elapsed + 'ms), stopping early');
      break;
    }
    
    // Early termination if we have enough uncached files
    if (uncachedFiles.length >= maxUncachedFiles) {
      log.info('Reached maximum uncached files limit (' + maxUncachedFiles + '), stopping cache check');
      break;
    }
    
    const batch = filePaths.slice(i, i + batchSize);
    const promises = batch.map(async (filePath) => {
      const isCached = await isFileCached(context, repoKey, filePath);
      if (isCached) {
        cachedCount++;
        log.debug('Already cached: ' + filePath);
      } else {
        uncachedFiles.push(filePath);
        log.debug('Not cached: ' + filePath);
      }
    });
    
    await Promise.all(promises);
    
    // Small delay between batches
    if (i + batchSize < filePaths.length && uncachedFiles.length < maxUncachedFiles) {
      await context.wait(50); // Reduced delay
    }
  }
  
  log.info('Cache check complete: ' + cachedCount + ' files already cached, ' + uncachedFiles.length + ' files need syncing');
  return uncachedFiles;
}

// Expand directory paths into individual file paths
async function expandDirectoryPaths(
  context: PlatformContext,
  repoKey: string,
  paths: string[],
  upstreamUrl?: string,
  onlyDelta: boolean = false
): Promise<string[]> {
  const expandedPaths: string[] = [];
  
  for (const path of paths) {
    if (path.endsWith('/')) {
      // This is a directory path - discover files within it
      log.info('Discovering files in directory: ' + path);
      
      if (upstreamUrl) {
        const upstreamFiles = await discoverFilesFromUpstream(context, upstreamUrl, path);
        if (upstreamFiles.length > 0) {
          log.info('Found ' + upstreamFiles.length + ' files from upstream');
          expandedPaths.push(...upstreamFiles);
        } else {
          log.warn('Could not discover files from upstream for directory: ' + path);
        }
      } else {
        log.warn('No upstream URL available for directory discovery: ' + path);
      }
    } else {
      // This is a file path - use as-is
      expandedPaths.push(path);
    }
  }
  
  // Apply delta filtering if enabled
  if (onlyDelta && expandedPaths.length > 0) {
    return await filterDeltaFiles(context, repoKey, expandedPaths, onlyDelta);
  }
  
  return expandedPaths;
}

// Get remote repository upstream URL
async function getRemoteRepositoryUpstreamUrl(
  context: PlatformContext,
  repoKey: string
): Promise<string | null> {
  try {
    const response = await context.clients.platformHttp.get('/artifactory/api/repositories/' + repoKey);
    
    if (response.status !== 200) {
      log.warn('Could not retrieve repository config for \'' + repoKey + '\': ' + response.status);
      return null;
    }
    
    const config = response.data;
    
    // Check if this is a remote repository
    if (config.rclass !== 'remote') {
      log.warn('Repository \'' + repoKey + '\' is not a remote repository (rclass: ' + config.rclass + ')');
      return null;
    }
    
    // Extract the upstream URL
    const upstreamUrl = config.url;
    if (upstreamUrl) {
      const cleanUrl = upstreamUrl.replace(/\/+$/, ''); // Remove trailing slashes
      log.info('Auto-detected upstream URL from repository config: ' + cleanUrl);
      return cleanUrl;
    } else {
      log.warn('No upstream URL found in repository \'' + repoKey + '\' configuration');
      return null;
    }
  } catch (error: any) {
    log.error('Error retrieving repository configuration: ' + error.message);
    return null;
  }
}

// Main worker function
export default async (
  context: PlatformContext,
  data: ScheduledEventRequest
): Promise<ScheduledEventResponse> => {
  const startTime = Date.now();
  
  try {
    log.info('SCHEDULED_EVENT triggered with ID: ' + data.triggerID);
    
    // Parse configuration from worker properties
    const targetRemoteRepo = getProperty(context, 'targetRemoteRepo');
    if (!targetRemoteRepo) {
      throw new Error('targetRemoteRepo property is required');
    }
    
    const paths = getProperty(context, 'paths');
    const pathsFile = getProperty(context, 'pathsFile');
    const upstreamUrl = getProperty(context, 'upstreamUrl');
    const maxWorkers = parseInt(getProperty(context, 'maxWorkers', '5'));
    const progress = getProperty(context, 'progress', 'true') === 'true';
    const onlyDelta = getProperty(context, 'onlyDelta', 'false') === 'true';
    const dryRun = getProperty(context, 'dryRun', 'false') === 'true';
    
    // Debug: Log the raw property values
    log.debug('Raw property values:');
    log.debug('  targetRemoteRepo: "' + getProperty(context, 'targetRemoteRepo') + '"');
    log.debug('  paths: "' + getProperty(context, 'paths') + '"');
    log.debug('  upstreamUrl: "' + getProperty(context, 'upstreamUrl') + '"');
    log.debug('  maxWorkers: "' + getProperty(context, 'maxWorkers') + '"');
    log.debug('  progress: "' + getProperty(context, 'progress') + '"');
    log.debug('  onlyDelta: "' + getProperty(context, 'onlyDelta') + '"');
    log.debug('  dryRun: "' + getProperty(context, 'dryRun') + '"');
    
    log.info('Configuration loaded: repo=' + targetRemoteRepo + ', maxWorkers=' + maxWorkers + ', progress=' + progress + ', onlyDelta=' + onlyDelta + ', dryRun=' + dryRun);
    
    // Gather path list
    let allPaths: string[] = [];
    const parsedPaths = parsePathsArg(paths);
    log.debug('Parsed paths from input: ' + JSON.stringify(parsedPaths));
    allPaths.push(...parsedPaths);
    
    // Note: pathsFile reading would require file system access which isn't available in workers
    // Users should use the paths property instead
    if (pathsFile) {
      log.warn('pathsFile property is not supported in worker context. Use paths property instead.');
    }
    
    allPaths = uniqueKeepOrder(allPaths);
    log.debug('Paths after deduplication: ' + JSON.stringify(allPaths));
    
    if (allPaths.length === 0) {
      log.warn('No artifact paths provided. Nothing to sync.');
      return {
        message: 'No artifact paths provided. Nothing to sync.'
      };
    }
    
    // Auto-detect upstream URL if not provided
    let finalUpstreamUrl = upstreamUrl;
    if (!finalUpstreamUrl) {
      log.info('No upstream URL provided, attempting to auto-detect from remote repository configuration...');
      finalUpstreamUrl = await getRemoteRepositoryUpstreamUrl(context, targetRemoteRepo);
      if (!finalUpstreamUrl) {
        log.warn('Could not auto-detect upstream URL. Directory discovery will not work.');
      }
    } else {
      log.info('Using provided upstream URL: ' + finalUpstreamUrl);
    }
    
    // Expand directory paths into individual file paths
    if (allPaths.length > 0) {
      log.info('Expanding directory paths into individual files...');
      allPaths = await expandDirectoryPaths(context, targetRemoteRepo, allPaths, finalUpstreamUrl, onlyDelta);
      allPaths = uniqueKeepOrder(allPaths);
    }
    
    if (allPaths.length === 0) {
      log.warn('No files to sync after path expansion.');
      return {
        message: 'No files to sync after path expansion.'
      };
    }
    
    log.info('Total artifacts to sync: ' + allPaths.length);
    
    // Log the file list
    log.info('=== FILE LIST TO BE PROCESSED ===');
    allPaths.forEach((path, index) => {
      log.info('[' + (index + 1) + '/' + allPaths.length + '] ' + path);
    });
    log.info('=== END FILE LIST ===');
    
    if (dryRun) {
      log.info('DRY-RUN mode is ON — no network calls will be made.');
      return {
        message: 'DRY-RUN: Would sync ' + allPaths.length + ' artifacts to ' + targetRemoteRepo
      };
    }
    
    // Execute parallel sync
    const result = await pullFilesParallel(
      context,
      targetRemoteRepo,
      allPaths,
      progress,
      dryRun,
      maxWorkers
    );
    
    const executionTime = Date.now() - startTime;
    
    if (result.failureCount > 0) {
      const message = 'Completed with ' + result.failureCount + ' failures out of ' + allPaths.length + ' items. Successfully processed: ' + result.successCount + ', Failed: ' + result.failureCount;
      log.error(message);
      return { message };
    } else {
      const message = 'Successfully synced ' + result.successCount + ' artifacts to ' + targetRemoteRepo + ' in ' + executionTime + 'ms';
      log.info(message);
      return { message };
    }
    
  } catch (error: any) {
    const executionTime = Date.now() - startTime;
    const message = 'SCHEDULED_EVENT failed after ' + executionTime + 'ms: ' + error.message;
    log.error(message);
    return { message };
  }
};
