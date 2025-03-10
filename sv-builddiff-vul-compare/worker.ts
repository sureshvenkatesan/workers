interface BuildDiffRequest {
    old: {
        type: string;
        component_id: string;
        package_id: string;
        path: string;
        version: string;
    };
    new: {
        type: string;
        component_id: string;
        package_id: string;
        path: string;
        version: string;
    };
}

/**
 * Gets the previous nth build number for a given build
 */
async function getPreviousBuildNumber(context: PlatformContext, buildName: string, currentBuildNumber: string, projectKey: string | null, n: number = 1): Promise<string | null> {
    try {
        console.log(`Getting previous build (n=${n}) for build ${buildName}, current build number: ${currentBuildNumber}`);
        console.log('Project Key: ' + projectKey);
        
        // Construct URL based on project key
        const url = projectKey 
            ? `/artifactory/api/build/${buildName}?project=${projectKey}`
            : `/artifactory/api/build/${buildName}`;
            
        console.log('Build API URL: ' + url);
        
        const buildsJson = await context.clients.platformHttp.get(url);
        console.log('Builds API Response status: ' + buildsJson.status);
        console.log('Builds API Response data: ' + JSON.stringify(buildsJson.data, null, 2));
        
        if (buildsJson.status === 200) {
            const builds = buildsJson.data.buildsNumbers;
            console.log('Total number of builds found: ' + builds.length);
            console.log('All builds: ' + JSON.stringify(builds, null, 2));
            
            // Find current build index
            const currentIndex = builds.findIndex(build => build.uri.substring(1) === currentBuildNumber);
            console.log('Current build index: ' + currentIndex);
            
            if (currentIndex >= 0) {
                console.log('Found current build at index: ' + currentIndex);
                // Calculate the target index for the previous build
                const targetIndex = currentIndex + parseInt(n.toString());
                console.log('Target index for previous build: ' + targetIndex);
                
                // Check if the target index exists in the array
                if (targetIndex >= 0 && targetIndex < builds.length) {
                    const previousBuild = builds[targetIndex].uri.substring(1);
                    console.log('Found previous build: ' + previousBuild);
                    return previousBuild;
                } else {
                    console.log(`No build found at target index ${targetIndex}. Total builds: ${builds.length}`);
                }
            } else {
                console.log('Current build not found in builds list');
            }
        }
        return null;
    } catch (error) {
        console.error('Error getting previous build: ' + error);
        console.error('Error details: ' + JSON.stringify({
            message: error.message,
            status: error.status,
            stack: error.stack
        }, null, 2));
        return null;
    }
}

/**
 * Generates a short-lived access token for the operation
 */
async function generateAccessToken(context: PlatformContext): Promise<string | null> {
    try {
        const groupName = await context.secrets.get('adminGroupName');
        console.log('Admin Group Name from secrets: ' + groupName);

        const tokenRequest = {
            "user_id": "build_analysis",
            "expires_in": 300,
            "scope": `applied-permissions/groups:${groupName}`,
            "refreshable": true
        };
        console.log('Token Request: ' + JSON.stringify(tokenRequest, null, 2));

        const tokenResp = await context.clients.platformHttp.post(
            "/access/api/v1/tokens", 
            tokenRequest,
            {
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );
        
        console.log('Token Response Status: ' + tokenResp.status);
        console.log('Token Response Headers: ' + JSON.stringify(tokenResp.headers, null, 2));
        console.log('Token Response Data: ' + JSON.stringify(tokenResp.data, null, 2));

        if (!tokenResp.data || !tokenResp.data.access_token) {
            console.error('No access token in response');
            return null;
        }

        return tokenResp.data.access_token;
    } catch (error) {
        console.error('Error generating access token: ' + error);
        console.error('Error details: ' + JSON.stringify({
            message: error.message,
            status: error.status,
            response: error.response ? {
                status: error.response.status,
                data: error.response.data
            } : 'No response',
            stack: error.stack
        }, null, 2));
        return null;
    }
}

/**
 * Constructs the build diff request data
 */
function constructBuildDiffRequest(buildName: string, buildRepo: string, currentBuild: string, previousBuild: string): BuildDiffRequest {
    return {
        "old": {
            "type": "build",
            "component_id": `build://[${buildRepo}]/${buildName}:${previousBuild}`,
            "package_id": `build://[${buildRepo}]/${buildName}`,
            "path": "",
            "version": previousBuild
        },
        "new": {
            "type": "build",
            "component_id": `build://[${buildRepo}]/${buildName}:${currentBuild}`,
            "package_id": `build://[${buildRepo}]/${buildName}`,
            "path": "",
            "version": currentBuild
        }
    };
}

/**
 * Formats the build diff response into an HTML table
 */
function formatBuildDiffToHtml(diffData: any): string {
    const changes: any[] = [];
    
    // Process added issues
    if (diffData.data?.all?.added) {
        diffData.data.all.added.forEach((item: any) => {
            if (item.issue) {
                changes.push({
                    change_type: 'Added',
                    component: item.issue.source_comp_id || item.issue.component,
                    issue_id: item.issue.id,
                    issue_type: item.issue.issue_type,
                    title: item.issue.title,
                    is_cve_applicable: item.new_applicability_status === 'applicable' ? 'Yes' : 'No',
                    fixed_versions: item.issue.component_versions?.fixed_versions?.join(', ') || 'N/A'
                });
            }
        });
    }

    // Process removed issues
    if (diffData.data?.all?.removed) {
        diffData.data.all.removed.forEach((item: any) => {
            if (item.issue) {
                changes.push({
                    change_type: 'Removed',
                    component: item.issue.source_comp_id || item.issue.component,
                    issue_id: item.issue.id,
                    issue_type: item.issue.issue_type,
                    title: item.issue.title,
                    is_cve_applicable: item.old_applicability_status === 'applicable' ? 'Yes' : 'No',
                    fixed_versions: item.issue.component_versions?.fixed_versions?.join(', ') || 'N/A'
                });
            }
        });
    }

    // Process changed issues
    if (diffData.data?.all?.changed) {
        diffData.data.all.changed.forEach((item: any) => {
            if (item.issue) {
                changes.push({
                    change_type: 'Changed',
                    component: item.issue.source_comp_id || item.issue.component,
                    issue_id: item.issue.id,
                    issue_type: item.issue.issue_type,
                    title: item.issue.title,
                    is_cve_applicable: item.new_applicability_status === 'applicable' ? 'Yes' : 'No',
                    fixed_versions: item.issue.component_versions?.fixed_versions?.join(', ') || 'N/A'
                });
            }
        });
    }

    // Generate HTML table
    if (changes.length === 0) {
        return '<p>No security changes found between builds.</p>';
    }

    let html = `
<table border="1" style="border-collapse: collapse; width: 100%;">
    <tr style="background-color: #f2f2f2;">
        <th style="padding: 8px;">Change Type</th>
        <th style="padding: 8px;">Component</th>
        <th style="padding: 8px;">Issue ID</th>
        <th style="padding: 8px;">Type</th>
        <th style="padding: 8px;">Title</th>
        <th style="padding: 8px;">CVE Applicable</th>
        <th style="padding: 8px;">Fixed Versions</th>
    </tr>`;

    changes.forEach(change => {
        html += `
    <tr>
        <td style="padding: 8px;">${change.change_type}</td>
        <td style="padding: 8px;">${change.component}</td>
        <td style="padding: 8px;">${change.issue_id}</td>
        <td style="padding: 8px;">${change.issue_type}</td>
        <td style="padding: 8px;">${change.title}</td>
        <td style="padding: 8px;">${change.is_cve_applicable}</td>
        <td style="padding: 8px;">${change.fixed_versions}</td>
    </tr>`;
    });

    html += `
</table>`;

    return html;
}

export default async (context: PlatformContext, data: AfterBuildInfoSaveRequest): Promise<AfterBuildInfoSaveResponse> => {
    try {
        console.log('Raw input data: ' + JSON.stringify(data, null, 2));
 
        const buildName = data.build.name;
        const buildRepo = data?.build?.buildRepo;
        const currentBuildNumber = data?.build?.number;
        
        // Get project key and n from secrets
        const projectKey = context.secrets.get('projectKey');
        const nthBuildToCompare = parseInt(context.secrets.get('prev_n_build_run_to_compare') || '1', 10);
        // const nthBuildToCompare = 2;

        console.log(`Project Key: ${projectKey}`);
        console.log(`Nth previous build to compare (parsed): ${nthBuildToCompare}`);
        
        // Log each value separately using template literals or concatenation
        console.log(`Build Name: ${buildName}`);
        console.log(`Build Repo: ${buildRepo}`);
        console.log(`Current Build Number: ${currentBuildNumber}`);
        
        // Log the input data object with concatenation
        console.log('Input data: ' + JSON.stringify({
            buildName: buildName || 'undefined',
            buildRepo: buildRepo || 'undefined',
            currentBuildNumber: currentBuildNumber || 'undefined',
            projectKey: projectKey || 'undefined',
            nthBuildToCompare,
            hasData: data ? 'yes' : 'no',
            hasBuild: data?.build ? 'yes' : 'no',
            fullData: data ? JSON.stringify(data, null, 2) : 'no data'
        }, null, 2));

        // Get previous build number - now passing projectKey and nthBuildToCompare
        const previousBuildNumber = await getPreviousBuildNumber(context, buildName, currentBuildNumber, projectKey, nthBuildToCompare);
        console.log('Previous Build Number: ' + previousBuildNumber);
        
        if (!previousBuildNumber) {
            console.log('No previous build found - exiting worker');
            return { message: "No previous build found" };
        }

        // Generate access token
        const accessToken = await generateAccessToken(context);
        console.log('Access Token obtained: ' + (accessToken ? 'Yes' : 'No'));
        
        if (!accessToken) {
            console.error('Failed to generate access token');
            return { message: "Failed to generate access token" };
        }

        // Get diff URL from secrets
        const diffUrl = context.secrets.get('buildDiffUrl');
        console.log('Build Diff URL: ' + diffUrl);
        
        // Construct request data
        const buildsDiffRequestData = constructBuildDiffRequest(buildName, buildRepo, currentBuildNumber, previousBuildNumber);
        console.log('Build Diff Request Data: ' + JSON.stringify(buildsDiffRequestData, null, 2));

        // Make the diff request with headers
        const buildsDiffRequestHeaders = {
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': '*/*',
                'Cookie': `__Host-REFRESHTOKEN=*;__Host-ACCESSTOKEN=${accessToken}`
            }
        };

        // Print curl command for testing
        console.log('Curl command for testing:');
        console.log(`curl -X POST '${diffUrl}' \\
    -H 'Content-Type: application/json' \\
    -H 'X-Requested-With: XMLHttpRequest' \\
    -H 'Accept: */*' \\
    -H 'Cookie: __Host-REFRESHTOKEN=*;__Host-ACCESSTOKEN=${accessToken}' \\
    -d '${JSON.stringify(buildsDiffRequestData)}'`);

        // Make the diff request
        const buildsDiffResponse = await context.clients.axios.post(diffUrl, buildsDiffRequestData, buildsDiffRequestHeaders);
        const buildsDiffResponseData = buildsDiffResponse.data;
        
        // Format and log the HTML table
        const htmlTable = formatBuildDiffToHtml(buildsDiffResponseData);
        console.log('Build Diff Summary:\n' + htmlTable);

        return {
            message: "proceed",
        };

    } catch (error) {
        // The platformHttp client throws PlatformHttpClientError if the HTTP request status is 400 or higher
        console.error(`Request failed with status code ${error.status || "<none>"} caused by : ${error.message}`);
        return {
            message: `Error: ${error.message}`,
        };
    }
};
