# Immutability Worker for JFrog Artifactory

## Overview
This worker enforces artifact immutability and duplicate prevention across multiple JFrog Platform Deployments (JPDs) and repositories. It checks incoming uploads against configurable rules, blocking or warning on duplicates according to your policy. The worker is highly configurable, supporting per-JPD, per-repo, and per-path granularity, and is optimized for performance in large, multi-instance environments.

---

## Installation

> **Prerequisite:**
> You must have the [JFrog CLI](https://jfrog.com/getcli/) installed to deploy and manage this worker. Follow the instructions on the JFrog website to download and configure the CLI for your platform.

To install and deploy this worker, follow these steps:

1. **Clone, Download or unzip the Worker project**
   - Place the worker files (`worker.ts`, `types.ts`, etc.) in your JFrog worker project directory.

2. **Setup the JFrog CLI**
   - Add a configuration for your JFrog Platform instance(s) using the JFrog CLI.
   - Use a JFrog Platform Access Token or OIDC for authentication.
      - Example (access token):
        ```bash
        jf config add --url=<platform-url> --access-token="<platform-access-token>" --interactive=false <server-id>
        ```
      - Example (OIDC   - For OIDC, see the [JFrog documentation](https://jfrog.com/blog/doing-devops-your-way-on-saas-solutions-connecting-jfrog-cli-to-your-jfrog-workers/) for details.

3. **Configure the Worker**
    - The worker is configured either [manually](https://jfrog.com/help/r/jfrog-platform-administration-documentation/configure-workers-in-the-ui) after the deployment or controlled by the settings in the workers manifest file:
        ```json
        {
            "name": "blockDuplicates",
            "description": "Prevent uploads if the artifact exists in the Platform",
            "filterCriteria": {
                "artifactFilterCriteria": {
                    "repoKeys": ["cw-generic-local"],
                    "anyLocal": false,
                    "anyRemote": false,
                    "anyFederated": false
                }
            },
            "secrets": {},
            "sourceCodePath": "./worker.ts",
            "action": "BEFORE_UPLOAD",
            "enabled": true,
            "debug": true,
            "projectKey": "",
            "application": "artifactory"
        }

4. **Deploy the Worker**
   - Deploy the worker to your JFrog Platform using the CLI:
     ```bash
     cd immutabilityWorker # Change to the worker directory
     jf worker deploy --server-id <server-id> # The server ID corresponds to the servers configured earlier with <jf config add>
     ```
     or alternativily executing the following will call jf worker deploy to the server that is in use (jf c show): 
     ```bash
     npm run deploy 
     ```
   - The worker will now be installed in your JFrog Platform and can be [configured in the UI](https://jfrog.com/help/r/jfrog-platform-administration-documentation/configure-workers-in-the-ui) or used based on the previous step. 
   - If using the manifest file, you can just redeploy if changes are made.

5. **Configure & Enable to worker**
    - If the worker is not enabled by default, you can enable it via the JFrog Platform UI:
      - Navigate to `Admin` > `Workers` > `Installed Workers`.
      - Find the `blockDuplicates` worker and toggle it to `Enabled`.
    - Modify which repositories this worker will check for uploads on by editing the `filterCriteria.artifactFilterCriteria.repoKeys` property in the worker manifest or via the UI.

6. **(Optional) CI/CD Integration**
   - You can automate testing and deployment using CI/CD tools such as GitHub Actions. See the [JFrog blog post](https://jfrog.com/blog/doing-devops-your-way-on-saas-solutions-connecting-jfrog-cli-to-your-jfrog-workers/) for a full example workflow.

---
## Runtime Configuration

The runtime operation of the worker is configured via a JSON file (typically `blocker-config.json`) stored in a an Artifactory repo. This repo is hardcoded in the worker as `worker-config` and can be changed in the worker code if needed. 
The configuration supports:

- **Per-JPD configuration:** Each JPD (Artifactory instance) is listed with its URL and relevant repos.
- **Per-repo configuration:** Each repo can specify a list of root paths to monitor for duplicates.
- **Per-path configuration:** Each path acts as a root; all subdirectories are included in the check.
- **Action:** Determines what happens when a duplicate is found (`block` or `warn`).

> **Note:** Changes to the configuration will be used in the next execution event.

### Example `blocker-config.json`
```json
{
  "jpds": [
    {
      "url": "acroiz.jfrog.io",
      "repos": [
        { "name": "cw-generic-local", "paths": ["immutable", "foo/bar"] },
        { "name": "chriswh-curation-test" }
      ]
    },
    {
      "url": "acrois.jfrog.io",
      "repos": [
        { "name": "cw-generic-local", "paths": ["immutable"] },
        { "name": "cw-duplicates-local", "paths": ["special/path", "my/special/nested"] }
      ]
    },
    {
      "url": "psazuse.jfrog.io",
      "repos": [
        { "name": "cw-duplicates-local", "paths": ["special/path", "my/special/nested/backup/path"] }
      ]
    }
  ],
  "action": "block"
}
```

#### Configuration Notes
- **JPDs:** Each JPD must have a `url` and a `repos` array. If `repos` is empty or omitted, the worker will search all repos in that JPD.
- **Repos:** Each repo can have a `name` and optional `paths`. If `paths` is omitted, the entire repo is checked for duplicates.
- **Paths:** Each path is treated as a root; all subdirectories are included in the duplicate check (e.g., `"my/special/nested"` matches any artifact under that directory tree).
- **Action:**
  - `block`: Prevents upload if a duplicate is found.
  - `warn`: Allows upload but logs a warning if a duplicate is found.

---

## Notes:

1. **How It Works**
   - On each upload, the worker checks the config to determine which JPDs, repos, and paths are relevant.
   - If the upload path matches any configured path (or is in a repo with no path restriction), the worker queries the relevant JPD(s) using AQL to check for duplicates.
   - If a duplicate is found, the worker blocks or warns according to the `action` in the config.
   - If no relevant JPD/repo/path is found, the upload is allowed immediately (no unnecessary network calls).

2. **Duplicate Detection**
   - The worker uses AQL queries with `$match` on the `path` field, so a configured path matches all subdirectories.
   - Only the directory part of the upload path is used for matching.
   - The check is optimized to short-circuit as soon as a duplicate is found.

3. **Logs and Results**
   - Logs are output at various levels (`debug`, `info`, `warn`, `error`).
   - When a duplicate is found, a log entry will indicate the JPD, repo, and path of the duplicate.
   - The worker returns a status (`UPLOAD_PROCEED`, `UPLOAD_STOP`, or `UPLOAD_WARN`) and a message describing the result.
   - Depending on the way the user did the upload (UI/CI/CLI), the status and a message will be displayed
   - Since the worker executes within the platform, its execution will also be visible within the Platform's logs. - You can monitor its activity through these logs or [access the troubleshooting panel](https://jfrog.com/help/r/jfrog-platform-administration-documentation/workers-troubleshooting) in the Platform UI.

4. **Performance:**
    - The worker avoids unnecessary JPD queries by pre-checking the config in memory so configuration can greatly affect performance.
    - Only relevant JPDs/repos/paths are queried, and the search is short-circuited on the first duplicate found.
5. **Extensibility:**
    - The config structure supports easy addition of new JPDs, repos, or paths.
6. **Best Practices:**
     - Set `LOG_LEVEL` to `warn` or `error` in production for optimal performance.

> NOTE: This worker is provided as-is and may require adjustments to fit your specific use case and environment. Thoroughly test in a non-production environment before deploying to production. If your configuration is very large or complex, consider performance implications and monitor the worker's behavior closely as a complex federation, slow networks or too many items could impact performance and push this beyond the worker sandbox limitations.
---

For more details, see the code comments and the [JFrog Workers documentation](https://jfrog.com/help/r/jfrog-platform-administration-documentation/workers). 