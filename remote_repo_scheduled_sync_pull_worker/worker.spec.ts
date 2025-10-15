import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { PlatformContext, PlatformClients, PlatformHttpClient , ScheduledEventRequest } from './types';
import runWorker from './worker';

describe("remote_repo_scheduled_sync_pull_worker tests", () => {
    let context: DeepMocked<PlatformContext>;
    let request: ScheduledEventRequest;
    let mockPlatformHttp: DeepMocked<PlatformHttpClient>;

    beforeEach(() => {
        mockPlatformHttp = createMock<PlatformHttpClient>({
            get: jest.fn().mockResolvedValue({ status: 200, data: {}, headers: {} })
        });

        context = createMock<PlatformContext>({
            clients: createMock<PlatformClients>({
                platformHttp: mockPlatformHttp,
                axios: {
                    get: jest.fn().mockResolvedValue({ status: 200, data: '<html><body><a href="file1.jar">file1.jar</a><a href="file2.pom">file2.pom</a></body></html>' })
                }
            }),
            properties: {
                get: jest.fn()
            }
        });

        request = {
            triggerID: 'test-trigger-123'
        };
    });

    describe('Basic Functionality', () => {
        it('should run successfully with basic configuration', async () => {
            // Mock properties
            (context.properties.get as jest.Mock)
                .mockReturnValueOnce('test-repo') // targetRemoteRepo
                .mockReturnValueOnce('file1.jar;file2.pom') // paths
                .mockReturnValueOnce('') // pathsFile
                .mockReturnValueOnce('') // upstreamUrl
                .mockReturnValueOnce('5') // maxWorkers
                .mockReturnValueOnce('true') // progress
                .mockReturnValueOnce('false') // onlyDelta
                .mockReturnValueOnce('false'); // dryRun

            // Mock repository config call
            mockPlatformHttp.get.mockResolvedValueOnce({
                status: 200,
                data: { rclass: 'remote', url: 'https://example.com' },
                headers: {}
            });

            // Mock sync calls
            mockPlatformHttp.get.mockResolvedValue({ status: 200, data: 'sync triggered', headers: {} });

            const result = await runWorker(context, request);

            expect(result.message).toContain('Successfully synced');
            expect(mockPlatformHttp.get).toHaveBeenCalledWith('/api/repositories/test-repo');
            expect(mockPlatformHttp.get).toHaveBeenCalledWith('/api/download/test-repo/file1.jar?content=none&progress=1');
            expect(mockPlatformHttp.get).toHaveBeenCalledWith('/api/download/test-repo/file2.pom?content=none&progress=1');
        });

        it('should handle missing targetRemoteRepo', async () => {
            (context.properties.get as jest.Mock).mockReturnValue(''); // targetRemoteRepo is empty

            const result = await runWorker(context, request);

            expect(result.message).toContain('targetRemoteRepo property is required');
        });

        it('should handle no paths provided', async () => {
            (context.properties.get as jest.Mock)
                .mockReturnValueOnce('test-repo') // targetRemoteRepo
                .mockReturnValueOnce(''); // paths (empty)

            const result = await runWorker(context, request);

            expect(result.message).toContain('No artifact paths provided');
        });

        it('should run in dry-run mode', async () => {
            (context.properties.get as jest.Mock)
                .mockReturnValueOnce('test-repo') // targetRemoteRepo
                .mockReturnValueOnce('file1.jar') // paths
                .mockReturnValueOnce('') // pathsFile
                .mockReturnValueOnce('') // upstreamUrl
                .mockReturnValueOnce('5') // maxWorkers
                .mockReturnValueOnce('true') // progress
                .mockReturnValueOnce('false') // onlyDelta
                .mockReturnValueOnce('true'); // dryRun

            const result = await runWorker(context, request);

            expect(result.message).toContain('DRY-RUN: Would sync 1 artifacts');
            // Should not make actual sync calls in dry-run mode
            expect(mockPlatformHttp.get).not.toHaveBeenCalledWith(expect.stringContaining('/api/download/'));
        });
    });

    describe('Path Processing', () => {
        it('should parse semicolon-separated paths correctly', async () => {
            (context.properties.get as jest.Mock)
                .mockReturnValueOnce('test-repo') // targetRemoteRepo
                .mockReturnValueOnce('path1/file1.jar;path2/file2.pom;path3/file3.war') // paths
                .mockReturnValueOnce('') // pathsFile
                .mockReturnValueOnce('') // upstreamUrl
                .mockReturnValueOnce('5') // maxWorkers
                .mockReturnValueOnce('true') // progress
                .mockReturnValueOnce('false') // onlyDelta
                .mockReturnValueOnce('false'); // dryRun

            mockPlatformHttp.get.mockResolvedValue({ status: 200, data: 'sync triggered', headers: {} });

            const result = await runWorker(context, request);

            expect(result.message).toContain('Successfully synced 3 artifacts');
            expect(mockPlatformHttp.get).toHaveBeenCalledWith('/api/download/test-repo/path1/file1.jar?content=none&progress=1');
            expect(mockPlatformHttp.get).toHaveBeenCalledWith('/api/download/test-repo/path2/file2.pom?content=none&progress=1');
            expect(mockPlatformHttp.get).toHaveBeenCalledWith('/api/download/test-repo/path3/file3.war?content=none&progress=1');
        });

        it('should handle paths with leading slashes', async () => {
            (context.properties.get as jest.Mock)
                .mockReturnValueOnce('test-repo') // targetRemoteRepo
                .mockReturnValueOnce('/path1/file1.jar;/path2/file2.pom') // paths with leading slashes
                .mockReturnValueOnce('') // pathsFile
                .mockReturnValueOnce('') // upstreamUrl
                .mockReturnValueOnce('5') // maxWorkers
                .mockReturnValueOnce('true') // progress
                .mockReturnValueOnce('false') // onlyDelta
                .mockReturnValueOnce('false'); // dryRun

            mockPlatformHttp.get.mockResolvedValue({ status: 200, data: 'sync triggered', headers: {} });

            const result = await runWorker(context, request);

            expect(result.message).toContain('Successfully synced 2 artifacts');
            expect(mockPlatformHttp.get).toHaveBeenCalledWith('/api/download/test-repo/path1/file1.jar?content=none&progress=1');
            expect(mockPlatformHttp.get).toHaveBeenCalledWith('/api/download/test-repo/path2/file2.pom?content=none&progress=1');
        });
    });

    describe('Repository Configuration', () => {
        it('should auto-detect upstream URL from repository config', async () => {
            (context.properties.get as jest.Mock)
                .mockReturnValueOnce('test-repo') // targetRemoteRepo
                .mockReturnValueOnce('file1.jar') // paths
                .mockReturnValueOnce('') // pathsFile
                .mockReturnValueOnce('') // upstreamUrl (empty, should auto-detect)
                .mockReturnValueOnce('5') // maxWorkers
                .mockReturnValueOnce('true') // progress
                .mockReturnValueOnce('false') // onlyDelta
                .mockReturnValueOnce('false'); // dryRun

            // Mock repository config response
            mockPlatformHttp.get.mockResolvedValueOnce({
                status: 200,
                data: { rclass: 'remote', url: 'https://repo1.maven.org/maven2' },
                headers: {}
            });

            // Mock sync calls
            mockPlatformHttp.get.mockResolvedValue({ status: 200, data: 'sync triggered', headers: {} });

            const result = await runWorker(context, request);

            expect(result.message).toContain('Successfully synced');
            expect(mockPlatformHttp.get).toHaveBeenCalledWith('/api/repositories/test-repo');
        });

        it('should handle non-remote repository', async () => {
            (context.properties.get as jest.Mock)
                .mockReturnValueOnce('test-repo') // targetRemoteRepo
                .mockReturnValueOnce('file1.jar') // paths
                .mockReturnValueOnce('') // pathsFile
                .mockReturnValueOnce('') // upstreamUrl
                .mockReturnValueOnce('5') // maxWorkers
                .mockReturnValueOnce('true') // progress
                .mockReturnValueOnce('false') // onlyDelta
                .mockReturnValueOnce('false'); // dryRun

            // Mock repository config response for local repository
            mockPlatformHttp.get.mockResolvedValueOnce({
                status: 200,
                data: { rclass: 'local', url: null },
                headers: {}
            });

            // Mock sync calls
            mockPlatformHttp.get.mockResolvedValue({ status: 200, data: 'sync triggered', headers: {} });

            const result = await runWorker(context, request);

            expect(result.message).toContain('Successfully synced');
            // Should still work even if upstream URL detection fails
        });
    });

    describe('Error Handling', () => {
        it('should handle sync failures gracefully', async () => {
            (context.properties.get as jest.Mock)
                .mockReturnValueOnce('test-repo') // targetRemoteRepo
                .mockReturnValueOnce('file1.jar;file2.pom') // paths
                .mockReturnValueOnce('') // pathsFile
                .mockReturnValueOnce('') // upstreamUrl
                .mockReturnValueOnce('5') // maxWorkers
                .mockReturnValueOnce('true') // progress
                .mockReturnValueOnce('false') // onlyDelta
                .mockReturnValueOnce('false'); // dryRun

            // Mock repository config call
            mockPlatformHttp.get.mockResolvedValueOnce({
                status: 200,
                data: { rclass: 'remote', url: 'https://example.com' },
                headers: {}
            });

            // Mock one success and one failure
            mockPlatformHttp.get
                .mockResolvedValueOnce({ status: 200, data: 'sync triggered', headers: {} }) // file1.jar success
                .mockResolvedValueOnce({ status: 404, data: 'Not found', headers: {} }); // file2.pom failure

            const result = await runWorker(context, request);

            expect(result.message).toContain('Completed with 1 failures');
            expect(result.message).toContain('Successfully processed: 1');
            expect(result.message).toContain('Failed: 1');
        });

        it('should handle repository config fetch failure', async () => {
            (context.properties.get as jest.Mock)
                .mockReturnValueOnce('test-repo') // targetRemoteRepo
                .mockReturnValueOnce('file1.jar') // paths
                .mockReturnValueOnce('') // pathsFile
                .mockReturnValueOnce('') // upstreamUrl
                .mockReturnValueOnce('5') // maxWorkers
                .mockReturnValueOnce('true') // progress
                .mockReturnValueOnce('false') // onlyDelta
                .mockReturnValueOnce('false'); // dryRun

            // Mock repository config call failure
            mockPlatformHttp.get.mockRejectedValueOnce(new Error('Repository not found'));

            // Mock sync calls
            mockPlatformHttp.get.mockResolvedValue({ status: 200, data: 'sync triggered', headers: {} });

            const result = await runWorker(context, request);

            expect(result.message).toContain('Successfully synced');
            // Should continue even if repository config fetch fails
        });
    });

    describe('Configuration Options', () => {
        it('should respect maxWorkers setting', async () => {
            (context.properties.get as jest.Mock)
                .mockReturnValueOnce('test-repo') // targetRemoteRepo
                .mockReturnValueOnce('file1.jar;file2.pom;file3.war;file4.jar;file5.pom') // 5 files
                .mockReturnValueOnce('') // pathsFile
                .mockReturnValueOnce('') // upstreamUrl
                .mockReturnValueOnce('2') // maxWorkers = 2
                .mockReturnValueOnce('true') // progress
                .mockReturnValueOnce('false') // onlyDelta
                .mockReturnValueOnce('false'); // dryRun

            mockPlatformHttp.get.mockResolvedValue({ status: 200, data: 'sync triggered', headers: {} });

            const result = await runWorker(context, request);

            expect(result.message).toContain('Successfully synced 5 artifacts');
            // Should process all files even with limited workers
        });

        it('should handle progress disabled', async () => {
            (context.properties.get as jest.Mock)
                .mockReturnValueOnce('test-repo') // targetRemoteRepo
                .mockReturnValueOnce('file1.jar') // paths
                .mockReturnValueOnce('') // pathsFile
                .mockReturnValueOnce('') // upstreamUrl
                .mockReturnValueOnce('5') // maxWorkers
                .mockReturnValueOnce('false') // progress = false
                .mockReturnValueOnce('false') // onlyDelta
                .mockReturnValueOnce('false'); // dryRun

            mockPlatformHttp.get.mockResolvedValue({ status: 200, data: 'sync triggered', headers: {} });

            const result = await runWorker(context, request);

            expect(result.message).toContain('Successfully synced');
            expect(mockPlatformHttp.get).toHaveBeenCalledWith('/api/download/test-repo/file1.jar?content=none');
            // Should not include progress=1 parameter
        });
    });

    describe('Directory Discovery', () => {
        it('should discover files from upstream directory', async () => {
            (context.properties.get as jest.Mock)
                .mockReturnValueOnce('test-repo') // targetRemoteRepo
                .mockReturnValueOnce('test-directory/') // paths (directory ending with /)
                .mockReturnValueOnce('') // pathsFile
                .mockReturnValueOnce('https://example.com') // upstreamUrl
                .mockReturnValueOnce('5') // maxWorkers
                .mockReturnValueOnce('true') // progress
                .mockReturnValueOnce('false') // onlyDelta
                .mockReturnValueOnce('false'); // dryRun

            // Mock repository config call
            mockPlatformHttp.get.mockResolvedValueOnce({
                status: 200,
                data: { rclass: 'remote', url: 'https://example.com' },
                headers: {}
            });

            // Mock external HTTP call for directory discovery
            (context.clients.axios.get as jest.Mock).mockResolvedValueOnce({
                status: 200,
                data: '<html><body><a href="file1.jar">file1.jar</a><a href="file2.pom">file2.pom</a></body></html>'
            });

            // Mock sync calls for discovered files
            mockPlatformHttp.get.mockResolvedValue({ status: 200, data: 'sync triggered', headers: {} });

            const result = await runWorker(context, request);

            expect(result.message).toContain('Successfully synced');
            expect(context.clients.axios.get).toHaveBeenCalledWith(
                'https://example.com/test-directory/',
                expect.objectContaining({
                    timeout: 10000,
                    headers: expect.objectContaining({
                        'User-Agent': 'JFrog-Worker/1.0'
                    })
                })
            );
            expect(mockPlatformHttp.get).toHaveBeenCalledWith('/api/download/test-repo/test-directory/file1.jar?content=none&progress=1');
            expect(mockPlatformHttp.get).toHaveBeenCalledWith('/api/download/test-repo/test-directory/file2.pom?content=none&progress=1');
        });

        it('should handle directory discovery failure gracefully', async () => {
            (context.properties.get as jest.Mock)
                .mockReturnValueOnce('test-repo') // targetRemoteRepo
                .mockReturnValueOnce('test-directory/') // paths (directory ending with /)
                .mockReturnValueOnce('') // pathsFile
                .mockReturnValueOnce('https://example.com') // upstreamUrl
                .mockReturnValueOnce('5') // maxWorkers
                .mockReturnValueOnce('true') // progress
                .mockReturnValueOnce('false') // onlyDelta
                .mockReturnValueOnce('false'); // dryRun

            // Mock repository config call
            mockPlatformHttp.get.mockResolvedValueOnce({
                status: 200,
                data: { rclass: 'remote', url: 'https://example.com' },
                headers: {}
            });

            // Mock external HTTP call failure
            (context.clients.axios.get as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

            const result = await runWorker(context, request);

            expect(result.message).toContain('No files to sync after path expansion');
            expect(context.clients.axios.get).toHaveBeenCalledWith(
                'https://example.com/test-directory/',
                expect.any(Object)
            );
        });
    });
});