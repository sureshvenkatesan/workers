import { PlatformContext } from 'jfrog-workers';
import { BeforeUploadRequest, BeforeUploadResponse, Header, UploadStatus } from './types';

let DEBUG = true; // Set to true for JSON expansion in logs NOT for production usage, logs will expand errors
let LOG_LEVEL: LogLevel = 'debug'; // Change this to control logging granularity - error or warn for production
const config_repo: string = 'worker-config';

export default async (context: PlatformContext, data: BeforeUploadRequest): Promise<BeforeUploadResponse> => {
    const startedAt: number = Date.now();
    let status: UploadStatus = UploadStatus.UPLOAD_UNSPECIFIED;
    let headers: { [key: string]: Header } = {};
    let message;

    try {
        if (data && data.metadata && data.metadata.repoPath && data.metadata.repoPath.key && data.metadata.repoPath.path) {
            log.debug('Processing: ' + JSON.stringify(data));
        } else {
            log.error('Unable to process as payload or essential metadata (repoPath.key, repoPath.path) is missing');
            log.error('Payload: ' + JSON.stringify(data));
            return {
                status: UploadStatus.UPLOAD_STOP,
                message: 'Essential data missing in the request payload.',
                modifiedRepoPath: undefined,
                headers: {},
            };
        }

        // Load config from a repo (have no filesystem access)
        const configString = await loadConfig(context, data.metadata.repoPath.key);

        const config = new Config(configString);

        log.debug('Config: ' + config);

        // Optimization: Check if any JPD is relevant for this repo/path
        const uploadDir = getDirectoryPathFromPath(data.metadata.repoPath.path);
        log.debug('Attempting to upload ' + data.metadata.repoPath.key + '/' + data.metadata.repoPath.path);

        const configJPDs = config.getJPDs();
        let relevantJPDs: { jpd: JPDConfig, repoConfig?: RepoConfig }[] = [];
        for (const jpd of configJPDs) {
            // If repos is empty or missing, search all repos in this JPD
            if (!Array.isArray(jpd.repos) || jpd.repos.length === 0) {
                relevantJPDs.push({ jpd });
                continue;
            }
            for (const repoConfig of jpd.repos) {
                if (Array.isArray(repoConfig.paths) && repoConfig.paths.length > 0) {
                    const matches = repoConfig.paths.some(configPath =>
                        uploadDir === configPath || uploadDir.startsWith(configPath.endsWith('/') ? configPath : configPath + '/')
                    );
                    if (matches) {
                        relevantJPDs.push({ jpd, repoConfig });
                    }
                } else {
                    // No paths defined, always relevant (search entire repo)
                    relevantJPDs.push({ jpd, repoConfig });
                }
            }
        }
        if (relevantJPDs.length === 0) {
            log.debug('No relevant JPDs for path "' + uploadDir + '". Allowing upload.');
            return {
                status: UploadStatus.UPLOAD_PROCEED,
                message: 'Artifact path is not in configured search scope for any JPD. Upload allowed.',
                modifiedRepoPath: data.metadata.repoPath,
                headers: {},
            };
        }

        // For each relevant JPD, check for duplicates in parallel
        let found = false;
        let foundResult: any = null;
        let foundMessage: string | undefined = undefined;

        const searchJobs = [];
        for (const { jpd, repoConfig } of relevantJPDs) {
            searchJobs.push((async () => {
                // Check if duplicate already found before starting search
                if (found) {
                    log.debug('Skipping search for JPD ' + jpd.url + (repoConfig ? ', repo: ' + repoConfig.name : ' (all repos)') + ' because duplicate already found.');
                    return;
                }
                
                log.debug('Starting search for JPD: ' + jpd.url + (repoConfig ? ', repo: ' + repoConfig.name : ' (all repos)'));
                try {
                    const fullPath = data.metadata.repoPath.path;
                    const fileNameToSearch = getFileNameFromPath(fullPath);
                    const filePathToSearch = getDirectoryPathFromPath(fullPath);
                    // If repoConfig is present, search that repo; if not, search all repos
                    let targetRepos: string[] = repoConfig ? [repoConfig.name] : [];
                    let pathsToSearch: string[] | undefined = repoConfig && repoConfig.paths ? repoConfig.paths : undefined;
                    const result = await findInstance(context, jpd.url, fileNameToSearch, filePathToSearch, targetRepos, 1, pathsToSearch);
                    log.debug('Finished search for JPD: ' + jpd.url + (repoConfig ? ', repo: ' + repoConfig.name : ' (all repos)'));
                    
                    // Check again if duplicate was found by another search while this one was running
                    if (!found && result && result.length > 0) {
                        found = true;
                        foundResult = result;
                        const firstFound = result[0];
                        const fullPathOfFoundItem = (firstFound.path === '.' ? '' : firstFound.path) + (firstFound.path === '.' ? '' : '/') + firstFound.name;
                        foundMessage = 'Artifact matching ' + data.metadata.repoPath.path + ' already exists in JPD: ' + jpd.url + ':' + firstFound.repo + '/' + fullPathOfFoundItem;
                        log.always('Duplicate found in JPD: ' + jpd.url + (repoConfig ? ', repo: ' + repoConfig.name : ' (all repos)') + ' - short-circuiting.');
                    }
                } catch (error) {
                    log.error('Error in search for JPD ' + jpd.url + (repoConfig ? ', repo: ' + repoConfig.name : ' (all repos)') + ': ' + (error.message || 'No message'));
                }
            })());
        }

        // We may be forced to wait here as AbortController does not seem to be available for axios but we'll try
        await Promise.allSettled(searchJobs);
        log.debug('All JPD searches completed.');

        if (found) {
            log.always('Duplicate found. Stopping upload and atempting to return early.');
            message = foundMessage || 'Duplicate artifact found. Upload will not proceed.';
            switch (config.action) {
                case 'block':
                    status = UploadStatus.UPLOAD_STOP;
                    break;
                case 'warn':
                    status = UploadStatus.UPLOAD_WARN;
                    break;
                default:
                    log.warn('Unknown action ' + config.action + ' in config. Defaulting to block.');
                    status = UploadStatus.UPLOAD_STOP;
                    message = 'Unknown action in config. Upload will not proceed.';
                    break;
            }
        } else {
            status = UploadStatus.UPLOAD_PROCEED;
            message = 'Artifact ' + data.metadata.repoPath.path + ' can be uploaded. No duplicates found.';
        }

    } catch (error) {
        status = UploadStatus.UPLOAD_STOP;
        message = 'Worker execution failed: ' + (error.message || 'Unknown error');
        log.error('Request failed with status code ' + (error.status || '<none>') + ' caused by : ' + error.message + ' ' + error.stack);
        log.error(JSON.stringify(error));

        throw error;
    }

    const durationMs: number = Date.now() - startedAt;
    log.debug('Worker ran for ' + durationMs + 'ms');

    return {
        status: status,
        message: message,
        modifiedRepoPath: data.metadata.repoPath,
        headers,
    };
}

function getFileNameFromPath(fullPath: string): string {
    if (!fullPath) return '';
    const segments = fullPath.split('/');
    return segments.pop() || '';
}

function getDirectoryPathFromPath(fullPath: string): string {
    if (!fullPath) return '';
    const segments = fullPath.split('/');
    if (segments.length <= 1) return '';

    segments.pop();
    return segments.join('/');
}

// Update: RepoConfig and JPDConfig types for per-JPD config
interface RepoConfig {
    name: string;
    paths?: string[];
}
interface JPDConfig {
    url: string;
    repos: RepoConfig[];
}

class Config {
    jpds: JPDConfig[];
    action: string;

    constructor(rawJSONString: string) {
        try {
            if (rawJSONString) {
                const rawJSON = JSON.parse(rawJSONString);
                // Parse jpds as array of objects with url and repos
                if (Array.isArray(rawJSON.jpds)) {
                    this.jpds = rawJSON.jpds.map((jpd: any) => {
                        if (typeof jpd === 'object' && jpd.url && Array.isArray(jpd.repos)) {
                            return {
                                url: jpd.url,
                                repos: jpd.repos.map((repo: any) => {
                                    if (typeof repo === 'string') {
                                        return { name: repo };
                                    } else if (typeof repo === 'object' && repo.name) {
                                        return { name: repo.name, paths: repo.paths };
                                    }
                                    return null;
                                }).filter(Boolean)
                            };
                        }
                        return null;
                    }).filter(Boolean);
                } else {
                    this.jpds = [];
                }
                this.action = rawJSON.action;
            } else {
                log.warn('Config string is empty. Initializing with default empty config.');
                this.jpds = [];
                this.action = 'warn';
            }
        } catch (e) {
            log.error('Failed to parse config JSON: ' + e.message + '. Raw string: ' + rawJSONString);
            log.warn('Initializing with default empty config due to parsing error.');
            this.jpds = [];
            this.action = 'warn';
        }
    }

    // Returns array of JPD configs
    getJPDs(): JPDConfig[] {
        return this.jpds;
    }

    // Returns all JPDs where the given repo is present
    getJPDsForRepo(repoName: string): JPDConfig[] {
        return this.jpds.filter(jpd => jpd.repos.some(r => r.name === repoName));
    }

    // Returns the RepoConfig for a given repo name in a given JPD
    getRepoConfig(jpd: JPDConfig, repoName: string): RepoConfig | undefined {
        return jpd.repos.find(r => r.name === repoName);
    }
}

type LogLevel = 'none' | 'error' | 'warn' | 'info' | 'debug' | 'all';
const logLevelPriority: Record<LogLevel, number> = {
    none: 0, error: 1, warn: 2, info: 3, debug: 4, all: 5
};
const log = {
    setLevel: (level: LogLevel) => { LOG_LEVEL = level; },
    info: (...args: any[]) => { if (logLevelPriority[LOG_LEVEL] >= logLevelPriority['info']) log._log('info', ...args); },
    debug: (...args: any[]) => { if (logLevelPriority[LOG_LEVEL] >= logLevelPriority['debug']) log._log('debug', ...args); },
    warn: (...args: any[]) => { if (logLevelPriority[LOG_LEVEL] >= logLevelPriority['warn']) log._log('warn', ...args); },
    error: (...args: any[]) => { if (logLevelPriority[LOG_LEVEL] >= logLevelPriority['error']) log._log('error', ...args); },
    always: (...args: any[]) => { log._log('log', ...args); },
    _log: (level: 'log' | 'info' | 'warn' | 'error' | 'debug', ...args: any[]) => {
        if (args.length <= 1) { (console[level] || console.log)(...args); return; }
        const firstArg = args[0];
        const processedArgs = args.slice(1).map(arg => {
            const isObject = arg !== null && typeof arg === 'object';
            const shouldExpand = LOG_LEVEL === 'debug' || LOG_LEVEL === 'all' || DEBUG;
            return isObject && shouldExpand ? JSON.stringify(arg) : arg;
        });
        (console[level] || console.log)(firstArg + ' ' + processedArgs.join(' '));
    }
};


async function loadConfig(context: PlatformContext, repo: string): Promise<string> {
    // TODO: accommodate both global and per repo config
    // const configFileName = `${config_repo}/${repo}/blocker-config.json`;
    const configFileName = `${config_repo}/blocker-config.json`;
    log.info('Getting config from: ' + configFileName);

    try {
        const response = await context.clients.platformHttp.get(`/artifactory/${configFileName}`);

        if (response && response.status === 200) {
            log.debug('Config loaded successfully. Status: ' + response.status);

            if (typeof response.data === 'string') {
                log.debug('LOADED config data (string): ' + response.data);
                return response.data;
            } else if (typeof response.data === 'object') {
                log.debug('LOADED config data (object): ', response.data);
                return JSON.stringify(response.data);
            } else {
                log.warn('Config data is not a string or object. Type: ' + (typeof response.data));
                return '';
            }
        } else {
            log.error('Unable to load config: Status ' + (response ? response.status : 'unknown') + '. Message: ' + (response ? response.data.message : 'No response object'));
            return '';
        }
    } catch (error) {
        log.error('Error loading config from ' + configFileName + ': ' + error.message);
        if (error.response) {
            log.error('Error response: ' + error.response.status + ' - ' + JSON.stringify(error.response.data));
        }
        return '';
    }
}

async function findInstance(context: PlatformContext, jpd: string, fileName: string, filePath: string, targetRepos: string[], limit = 1, pathsToSearch?: string[]): Promise<Array<any>> {
    const criteria: any[] = [];

    // Repository criteria
    if (targetRepos && targetRepos.length > 0) {
        if (targetRepos.length === 1) {
            criteria.push({ "repo": targetRepos[0] });
        } else {
            const repoOrClauses = targetRepos.map(repoName => ({ "repo": repoName }));
            criteria.push({ "$or": repoOrClauses });
        }
    } // else: no repo filter, search all repos

    // Path criteria: if pathsToSearch is provided, use $or for all paths; else use filePath or "."
    if (pathsToSearch && pathsToSearch.length > 0) {
        if (pathsToSearch.length === 1) {
            criteria.push({ "path": { "$match": pathsToSearch[0] + "*" } });
        } else {
            const pathOrClauses = pathsToSearch.map(p => ({ "path": { "$match": p + "*" } }));
            criteria.push({ "$or": pathOrClauses });
        }
    } else {
        criteria.push({ "path": filePath ? filePath : "." });
    }

    // Name criteria
    if (fileName) {
        criteria.push({ "name": { "$match": fileName } });
    } else {
        log.warn('findInstance on JPD ' + jpd + ': fileName is empty, defaulting to "*" to match any file name within the path.');
        criteria.push({ "name": { "$match": "*" } });
    }

    const queryCriteria = { "$and": criteria };
    const findClause = JSON.stringify(queryCriteria);
    let query = `items.find(${findClause})`;

    query = `${query}.include("repo","path","name")`;
    if (limit > 0) {
        query = `${query}.limit(${limit})`;
    }

    const versions = await runAql(context, jpd, query);
    log.debug('JPD ' + jpd + ': Found ' + versions.length + ' versions for criteria ' + findClause + '. Query: ' + query);
    return versions;
}

async function runAql(context: PlatformContext, jpd: string, query: string): Promise<Array<any>> {
    log.debug('Running AQL on JPD ' + jpd + ': ' + query);
    try {
        const queryResponse = await context.clients.axios.post(
            `https://${jpd}/artifactory/api/search/aql`,
            query,
            {
                headers: {
                    'Authorization': 'Bearer ' + context.platformToken,
                    'Content-Type': 'text/plain'
                }
            }
        );

        return (queryResponse.data.results || []) as Array<any>;
    } catch (x) {
        log.error('AQL query on JPD ' + jpd + ' failed: ' + x.message + '. Query: ' + query);
        if (x.response) {
            log.error('AQL error response on JPD ' + jpd + ': ' + x.response.status + ' - ' + JSON.stringify(x.response.data));
        } else {
            log.error('AQL error details on JPD ' + jpd + ': ' + JSON.stringify(x));
        }

        throw x;
    }
}