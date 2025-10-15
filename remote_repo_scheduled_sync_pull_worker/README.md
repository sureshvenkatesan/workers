# Remote Repository Scheduled Sync Pull Worker

A JFrog SCHEDULED_EVENT Worker that automatically pre-caches artifacts into remote repositories using the Artifact Sync Download API. This worker runs on a configurable cron schedule and pulls specified artifacts from upstream sources into your remote repository cache.

## Overview

This worker provides automated artifact pre-caching for:
- Remote repositories that proxy external sources (Maven Central, Confluent packages, etc.)
- Scheduled synchronization based on cron expressions
- Parallel processing with configurable worker limits
- Comprehensive error handling and logging
- Dry-run mode for testing configurations

## Features

- **SCHEDULED_EVENT Type**: Automatically triggers based on cron schedule
- **Property-Based Configuration**: All settings defined in worker manifest properties
- **Artifact Sync Download API**: Uses JFrog's official API for pre-caching
- **Parallel Processing**: Configurable number of parallel workers
- **Path Expansion**: Supports both individual files and directory paths
- **Upstream URL Auto-Detection**: Automatically detects upstream URLs from repository configuration
- **Delta Sync Support**: Only sync files not already in cache (when implemented)
- **Dry-Run Mode**: Test configurations without making actual sync calls
- **Comprehensive Logging**: Detailed logging using JFrog Worker framework

## Configuration

### Worker Manifest (manifest.json)

```json
{
  "name": "remote_repo_scheduled_sync_pull_worker",
  "description": "Scheduled worker to pre-cache artifacts into remote repositories using Artifact Sync Download API",
  "filterCriteria": {
    "schedule": {
      "cron": "0 */6 * * *",
      "timezone": "UTC"
    }
  },
  "secrets": {},
  "properties": {
    "targetRemoteRepo": "example-maven-remote",
    "paths": "com/opencsv/opencsv/5.7.1/opencsv-5.7.1.jar;com/opencsv/opencsv/5.7.1/opencsv-5.7.1.pom",
    "upstreamUrl": "",
    "maxWorkers": "5",
    "progress": "true",
    "onlyDelta": "false",
    "dryRun": "false"
  },
  "sourceCodePath": "./worker.ts",
  "action": "SCHEDULED_EVENT",
  "enabled": false,
  "debug": false,
  "projectKey": "",
  "application": "worker"
}
```

### Worker Properties

| Property | Required | Description | Example |
|----------|----------|-------------|---------|
| `targetRemoteRepo` | Yes | Target remote repository key | `"maven-central-remote"` |
| `paths` | Yes | Semicolon-separated list of artifact paths | `"com/opencsv/opencsv/5.7.1/opencsv-5.7.1.jar;com/opencsv/opencsv/5.7.1/opencsv-5.7.1.pom"` |
| `upstreamUrl` | No | Upstream URL for directory discovery (auto-detected if empty) | `"https://repo1.maven.org/maven2"` |
| `maxWorkers` | No | Maximum number of parallel workers (default: 5) | `"10"` |
| `progress` | No | Enable progress indicators (default: true) | `"false"` |
| `onlyDelta` | No | Only sync files not already in cache (default: false) | `"true"` |
| `dryRun` | No | Dry-run mode - no actual sync (default: false) | `"true"` |

### Cron Schedule

The worker uses standard cron expressions:
- `"0 */6 * * *"` - Every 6 hours
- `"0 0 * * *"` - Daily at midnight
- `"0 9 * * 1"` - Every Monday at 9 AM
- `"0 */2 * * *"` - Every 2 hours

## Usage Examples

### Basic Maven Artifact Sync (Every 6 Hours)

```json
{
  "properties": {
    "targetRemoteRepo": "maven-central-remote",
    "paths": "com/opencsv/opencsv/5.7.1/opencsv-5.7.1.jar;com/opencsv/opencsv/5.7.1/opencsv-5.7.1.pom"
  },
  "filterCriteria": {
    "schedule": {
      "cron": "0 */6 * * *"
    }
  }
}
```

### Confluent Packages Sync (Daily)

```json
{
  "properties": {
    "targetRemoteRepo": "confluent-remote",
    "paths": "confluent-control-center-next-gen/",
    "upstreamUrl": "https://packages.confluent.io",
    "maxWorkers": "10"
  },
  "filterCriteria": {
    "schedule": {
      "cron": "0 0 * * *"
    }
  }
}
```

### Dry-Run Testing (Every Hour)

```json
{
  "properties": {
    "targetRemoteRepo": "test-remote",
    "paths": "test/artifact/1.0.0/artifact-1.0.0.jar",
    "dryRun": "true"
  },
  "filterCriteria": {
    "schedule": {
      "cron": "0 * * * *"
    }
  }
}
```

### High-Performance Sync (Every 2 Hours)

```json
{
  "properties": {
    "targetRemoteRepo": "high-volume-remote",
    "paths": "org/springframework/spring-core/5.3.21/spring-core-5.3.21.jar;org/springframework/spring-context/5.3.21/spring-context-5.3.21.jar",
    "maxWorkers": "20",
    "progress": "false"
  },
  "filterCriteria": {
    "schedule": {
      "cron": "0 */2 * * *"
    }
  }
}
```

## Path Format

### Individual Files
```
com/opencsv/opencsv/5.7.1/opencsv-5.7.1.jar
org/springframework/spring-core/5.3.21/spring-core-5.3.21.jar
```

### Multiple Files (Semicolon-Separated)
```
com/opencsv/opencsv/5.7.1/opencsv-5.7.1.jar;com/opencsv/opencsv/5.7.1/opencsv-5.7.1.pom;com/opencsv/opencsv/5.7.1/opencsv-5.7.1-sources.jar
```

### Directory Paths (Ending with /)
```
confluent-control-center-next-gen/
org/springframework/spring-core/5.3.21/
```

**Note**: Directory discovery from upstream sources is implemented using external HTTP calls. It works with standard web servers that provide directory listings (like Apache, Nginx, etc.). For best results, use specific file paths when possible.

## API Endpoints Used

The worker uses the following JFrog Artifactory APIs:

### Artifact Sync Download API
```
GET /api/download/{repoKey}/{filePath}?content=none&progress=1
```

### Repository Configuration API
```
GET /api/repositories/{repoKey}
```

## Response Messages

### Success Messages

**Successful Sync:**
```
Successfully synced 5 artifacts to maven-central-remote in 1250ms
```

**Dry-Run Mode:**
```
DRY-RUN: Would sync 3 artifacts to test-remote
```

**No Paths Provided:**
```
No artifact paths provided. Nothing to sync.
```

### Error Messages

**Configuration Error:**
```
SCHEDULED_EVENT failed after 50ms: targetRemoteRepo property is required
```

**Partial Failures:**
```
Completed with 2 failures out of 10 items. Successfully processed: 8, Failed: 2
```

**Repository Error:**
```
SCHEDULED_EVENT failed after 200ms: Repository 'invalid-repo' is not a remote repository
```

## Logging

The worker provides comprehensive logging at different levels:

```
[INFO] SCHEDULED_EVENT triggered with ID: cron-12345
[INFO] Configuration loaded: repo=maven-central-remote, maxWorkers=5, progress=true, onlyDelta=false, dryRun=false
[INFO] No upstream URL provided, attempting to auto-detect from remote repository configuration...
[INFO] Auto-detected upstream URL from repository config: https://repo1.maven.org/maven2
[INFO] Total artifacts to sync: 3
[INFO] === FILE LIST TO BE PROCESSED ===
[INFO] [1/3] com/opencsv/opencsv/5.7.1/opencsv-5.7.1.jar
[INFO] [2/3] com/opencsv/opencsv/5.7.1/opencsv-5.7.1.pom
[INFO] [3/3] com/opencsv/opencsv/5.7.1/opencsv-5.7.1-sources.jar
[INFO] === END FILE LIST ===
[INFO] Starting parallel execution with 5 workers for 3 files...
[INFO] [OK] com/opencsv/opencsv/5.7.1/opencsv-5.7.1.jar :: sync triggered
[INFO] [OK] com/opencsv/opencsv/5.7.1/opencsv-5.7.1.pom :: sync triggered
[INFO] [OK] com/opencsv/opencsv/5.7.1/opencsv-5.7.1-sources.jar :: sync triggered
[INFO] Successfully synced 3 artifacts to maven-central-remote in 1250ms
```

## Error Handling

The worker implements robust error handling:

- **Configuration Validation**: Validates required properties before execution
- **Repository Validation**: Checks if target repository exists and is remote
- **Individual File Failures**: Continues processing even if some files fail
- **Network Resilience**: Handles API call failures gracefully
- **Property Access**: Multiple fallback methods for accessing worker properties

## Performance Considerations

- **Parallel Processing**: Configurable number of workers (default: 5)
- **Batch Processing**: Processes files in batches to avoid overwhelming the system
- **Rate Limiting**: Small delays between batches to be respectful to the system
- **Progress Tracking**: Optional progress indicators for monitoring

## Limitations

1. **File System Access**: Workers cannot read files from the file system, so `pathsFile` property is not supported
2. **Directory Discovery**: Works with standard web servers that provide HTML directory listings (Apache, Nginx, etc.)
3. **Delta Sync**: Cache repository checking for delta sync is not fully implemented
4. **Large File Lists**: Very large path lists may hit worker execution time limits
5. **Recursion Limits**: Directory discovery is limited to 5 subdirectories to prevent infinite recursion

## Testing

Run the test suite:

```bash
npm test
```

The tests cover:
- Basic functionality with various configurations
- Path processing and parsing
- Repository configuration handling
- Error handling scenarios
- Configuration options validation

## Deployment

1. **Configure Properties**: Update the `properties` section in `manifest.json`
2. **Set Schedule**: Configure the `cron` expression in `filterCriteria.schedule`
3. **Deploy Worker**: Use JFrog CLI to deploy the worker

```bash
cd remote_repo_scheduled_sync_pull_worker
jf worker deploy
```

4. **Enable Worker**: Enable the worker in the JFrog Platform UI or set `"enabled": true` in manifest

## Monitoring

Monitor worker execution through JFrog Platform logs. Each execution will show:
- Trigger ID from the scheduled event
- Configuration loaded
- Files being processed
- Success/failure counts
- Execution time
- Detailed error messages (if any)

## Best Practices

1. **Start with Dry-Run**: Always test configurations with `"dryRun": "true"` first
2. **Use Specific Paths**: Prefer specific file paths over directory paths for reliability
3. **Monitor Performance**: Adjust `maxWorkers` based on your system's capacity
4. **Regular Monitoring**: Check logs regularly for any sync failures
5. **Incremental Testing**: Start with small path lists and gradually increase
6. **Schedule Optimization**: Choose appropriate cron schedules based on your needs

## Troubleshooting

### Common Issues

**"targetRemoteRepo property is required"**
- Ensure the `targetRemoteRepo` property is set in the worker manifest

**"No artifact paths provided"**
- Check that the `paths` property contains valid artifact paths

**"Repository 'X' is not a remote repository"**
- Verify the repository exists and is configured as a remote repository

**"Could not auto-detect upstream URL"**
- The repository may not be properly configured or may not be a remote repository

**Sync Failures**
- Check if the artifact paths are correct and exist in the upstream source
- Verify the remote repository configuration
- Check network connectivity and permissions

### Debug Mode

Enable debug mode in the manifest to get more detailed logging:

```json
{
  "debug": true
}
```

This will provide additional debug information in the logs.

---

This worker provides a robust solution for automated artifact pre-caching in JFrog Artifactory remote repositories, helping to improve build performance and reduce external dependencies.
