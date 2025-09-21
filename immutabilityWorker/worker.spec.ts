import { PlatformContext, PlatformClients, PlatformHttpClient } from 'jfrog-workers';
import { BeforeUploadRequest, UploadStatus } from './types';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import runWorker from './worker';

describe("Immutability Worker Tests", () => {
    let context: DeepMocked<PlatformContext>;
    let mockAxios: any;

    beforeEach(() => {
        // Mock axios for AQL queries
        mockAxios = {
            post: jest.fn()
        };

        context = createMock<PlatformContext>({
            clients: createMock<PlatformClients>({
                platformHttp: createMock<PlatformHttpClient>({
                    get: jest.fn().mockResolvedValue({ status: 200 })
                }),
                axios: mockAxios
            }),
            platformToken: 'mock-token'
        });
    });

    describe('Basic Functionality', () => {
        test('should allow upload when no relevant JPDs found', async () => {
            const config = {
                data: {
                    "jpds": [
                        {
                            "url": "test.jfrog.io",
                            "repos": [
                                { "name": "other-repo", "paths": ["different/path"] }
                            ]
                        }
                    ],
                    "action": "block"
                },
                status: 200
            };

            (context.clients.platformHttp.get as jest.Mock).mockResolvedValueOnce(config);

            const request = createMockRequest("test-repo", "unrelated/path/file.txt");
            const result = await runWorker(context, request);

            expect(result.status).toBe(UploadStatus.UPLOAD_PROCEED);
            expect(result.message).toContain('not in configured search scope');
        });

        test('should block upload when duplicate found', async () => {
            const config = {
                data: {
                    "jpds": [
                        {
                            "url": "test.jfrog.io",
                            "repos": [
                                { "name": "test-repo", "paths": ["test/path"] }
                            ]
                        }
                    ],
                    "action": "block"
                },
                status: 200
            };

            (context.clients.platformHttp.get as jest.Mock).mockResolvedValueOnce(config);
            mockAxios.post.mockResolvedValueOnce({
                data: {
                    results: [{
                        repo: "test-repo",
                        path: "test/path",
                        name: "file.txt"
                    }]
                }
            });

            const request = createMockRequest("test-repo", "test/path/file.txt");
            const result = await runWorker(context, request);

            expect(result.status).toBe(UploadStatus.UPLOAD_STOP);
            expect(result.message).toContain('already exists');
        });

        test('should warn when duplicate found and action is warn', async () => {
            const config = {
                data: {
                    "jpds": [
                        {
                            "url": "test.jfrog.io",
                            "repos": [
                                { "name": "test-repo", "paths": ["test/path"] }
                            ]
                        }
                    ],
                    "action": "warn"
                },
                status: 200
            };

            (context.clients.platformHttp.get as jest.Mock).mockResolvedValueOnce(config);
            mockAxios.post.mockResolvedValueOnce({
                data: {
                    results: [{
                        repo: "test-repo",
                        path: "test/path",
                        name: "file.txt"
                    }]
                }
            });

            const request = createMockRequest("test-repo", "test/path/file.txt");
            const result = await runWorker(context, request);

            expect(result.status).toBe(UploadStatus.UPLOAD_WARN);
            expect(result.message).toContain('already exists');
        });
    });

    describe('Path Matching Logic', () => {
        test('should match exact path', async () => {
            const config = {
                data: {
                    "jpds": [
                        {
                            "url": "test.jfrog.io",
                            "repos": [
                                { "name": "test-repo", "paths": ["exact/path"] }
                            ]
                        }
                    ],
                    "action": "block"
                },
                status: 200
            };

            (context.clients.platformHttp.get as jest.Mock).mockResolvedValueOnce(config);
            mockAxios.post.mockResolvedValueOnce({
                data: { results: [] }
            });

            const request = createMockRequest("test-repo", "exact/path/file.txt");
            const result = await runWorker(context, request);

            expect(mockAxios.post).toHaveBeenCalledWith(
                expect.stringContaining('test.jfrog.io'),
                expect.stringContaining('"$match":"exact/path*"'),
                expect.any(Object)
            );
        });

        test('should match subdirectory paths', async () => {
            const config = {
                data: {
                    "jpds": [
                        {
                            "url": "test.jfrog.io",
                            "repos": [
                                { "name": "test-repo", "paths": ["root/path"] }
                            ]
                        }
                    ],
                    "action": "block"
                },
                status: 200
            };

            (context.clients.platformHttp.get as jest.Mock).mockResolvedValueOnce(config);
            mockAxios.post.mockResolvedValueOnce({
                data: { results: [] }
            });

            const request = createMockRequest("test-repo", "root/path/subdir/file.txt");
            const result = await runWorker(context, request);

            expect(mockAxios.post).toHaveBeenCalledWith(
                expect.stringContaining('test.jfrog.io'),
                expect.stringContaining('"$match":"root/path*"'),
                expect.any(Object)
            );
        });

        test('should search entire repo when no paths specified', async () => {
            const config = {
                data: {
                    "jpds": [
                        {
                            "url": "test.jfrog.io",
                            "repos": [
                                { "name": "test-repo" }
                            ]
                        }
                    ],
                    "action": "block"
                },
                status: 200
            };

            (context.clients.platformHttp.get as jest.Mock).mockResolvedValueOnce(config);
            mockAxios.post.mockResolvedValueOnce({
                data: { results: [] }
            });

            const request = createMockRequest("test-repo", "any/path/file.txt");
            const result = await runWorker(context, request);

            expect(mockAxios.post).toHaveBeenCalledWith(
                expect.stringContaining('test.jfrog.io'),
                expect.stringContaining('"path":"any/path"'),
                expect.any(Object)
            );
        });
    });

    describe('JPD Filtering', () => {
        test('should search all repos when repos array is empty', async () => {
            const config = {
                data: {
                    "jpds": [
                        {
                            "url": "test.jfrog.io",
                            "repos": []
                        }
                    ],
                    "action": "block"
                },
                status: 200
            };

            (context.clients.platformHttp.get as jest.Mock).mockResolvedValueOnce(config);
            mockAxios.post.mockResolvedValueOnce({
                data: { results: [] }
            });

            const request = createMockRequest("any-repo", "any/path/file.txt");
            const result = await runWorker(context, request);

            expect(mockAxios.post).toHaveBeenCalledWith(
                expect.stringContaining('test.jfrog.io'),
                expect.stringContaining('"path":"any/path"'),
                expect.any(Object)
            );
        });

        test('should only search relevant JPDs', async () => {
            const config = {
                data: {
                    "jpds": [
                        {
                            "url": "relevant.jfrog.io",
                            "repos": [
                                { "name": "test-repo", "paths": ["test/path"] }
                            ]
                        },
                        {
                            "url": "irrelevant.jfrog.io",
                            "repos": [
                                { "name": "other-repo", "paths": ["other/path"] }
                            ]
                        }
                    ],
                    "action": "block"
                },
                status: 200
            };

            (context.clients.platformHttp.get as jest.Mock).mockResolvedValueOnce(config);
            mockAxios.post.mockResolvedValueOnce({
                data: { results: [] }
            });

            const request = createMockRequest("test-repo", "test/path/file.txt");
            const result = await runWorker(context, request);

            expect(mockAxios.post).toHaveBeenCalledTimes(1);
            expect(mockAxios.post).toHaveBeenCalledWith(
                expect.stringContaining('relevant.jfrog.io'),
                expect.any(String),
                expect.any(Object)
            );
        });
    });

    describe('Error Handling', () => {
        test('should handle missing metadata', async () => {
            const request = { 
                userContext: { 
                    id: "test",
                    realm: "test-realm",
                    isToken: true
                },
                metadata: {
                    repoPath: {
                        key: "",
                        path: "",
                        id: "",
                        isRoot: false,
                        isFolder: false
                    },
                    contentLength: 0,
                    lastModified: 0,
                    trustServerChecksums: true,
                    disableRedirect: true,
                    repoType: 1,
                    servletContextUrl: "",
                    skipJarIndexing: false
                },
                headers: {},
                artifactProperties: {}
            };
            
            // The worker should return UPLOAD_STOP for missing metadata without throwing
            const result = await runWorker(context, request);
            expect(result.status).toBe(UploadStatus.UPLOAD_STOP);
            expect(result.message).toContain('Essential data missing');
        });

        test('should handle config loading error', async () => {
            (context.clients.platformHttp.get as jest.Mock).mockRejectedValueOnce(new Error('Config not found'));

            const request = createMockRequest("test-repo", "test/path/file.txt");
            
            // The worker should continue with empty config when config loading fails
            const result = await runWorker(context, request);
            expect(result.status).toBe(UploadStatus.UPLOAD_PROCEED);
            expect(result.message).toContain('not in configured search scope');
        });

        test('should handle AQL query error', async () => {
            const config = {
                data: {
                    "jpds": [
                        {
                            "url": "test.jfrog.io",
                            "repos": [
                                { "name": "test-repo", "paths": ["test/path"] }
                            ]
                        }
                    ],
                    "action": "block"
                },
                status: 200
            };

            (context.clients.platformHttp.get as jest.Mock).mockResolvedValueOnce(config);
            mockAxios.post.mockRejectedValueOnce(new Error('AQL query failed'));

            const request = createMockRequest("test-repo", "test/path/file.txt");
            
            // The worker should continue and allow upload when AQL query fails
            const result = await runWorker(context, request);
            expect(result.status).toBe(UploadStatus.UPLOAD_PROCEED);
            expect(result.message).toContain('No duplicates found');
        });
    });

    describe('Performance Optimizations', () => {
        test('should short-circuit on first duplicate found', async () => {
            const config = {
                data: {
                    "jpds": [
                        {
                            "url": "first.jfrog.io",
                            "repos": [
                                { "name": "test-repo", "paths": ["test/path"] }
                            ]
                        },
                        {
                            "url": "second.jfrog.io",
                            "repos": [
                                { "name": "test-repo", "paths": ["test/path"] }
                            ]
                        }
                    ],
                    "action": "block"
                },
                status: 200
            };

            (context.clients.platformHttp.get as jest.Mock).mockResolvedValueOnce(config);
            mockAxios.post
                .mockResolvedValueOnce({
                    data: {
                        results: [{
                            repo: "test-repo",
                            path: "test/path",
                            name: "file.txt"
                        }]
                    }
                })
                .mockResolvedValueOnce({
                    data: { results: [] }
                });

            const request = createMockRequest("test-repo", "test/path/file.txt");
            const result = await runWorker(context, request);

            // With parallel execution, both calls may be made, but only the first result should be processed
            expect(mockAxios.post).toHaveBeenCalledTimes(2);
            expect(result.status).toBe(UploadStatus.UPLOAD_STOP);
            expect(result.message).toContain('already exists in JPD: first.jfrog.io');
        });
    });

    describe('AQL Query Generation', () => {
        test('should generate correct AQL for single path', async () => {
            const config = {
                data: {
                    "jpds": [
                        {
                            "url": "test.jfrog.io",
                            "repos": [
                                { "name": "test-repo", "paths": ["single/path"] }
                            ]
                        }
                    ],
                    "action": "block"
                },
                status: 200
            };

            (context.clients.platformHttp.get as jest.Mock).mockResolvedValueOnce(config);
            mockAxios.post.mockResolvedValueOnce({
                data: { results: [] }
            });

            const request = createMockRequest("test-repo", "single/path/file.txt");
            await runWorker(context, request);

            const aqlCall = mockAxios.post.mock.calls[0];
            const query = aqlCall[1];
            
            expect(query).toContain('"repo":"test-repo"');
            expect(query).toContain('"$match":"single/path*"');
            expect(query).toContain('"$match":"file.txt"');
            expect(query).toContain('.limit(1)');
        });

        test('should generate correct AQL for multiple paths', async () => {
            const config = {
                data: {
                    "jpds": [
                        {
                            "url": "test.jfrog.io",
                            "repos": [
                                { "name": "test-repo", "paths": ["path1", "path2"] }
                            ]
                        }
                    ],
                    "action": "block"
                },
                status: 200
            };

            (context.clients.platformHttp.get as jest.Mock).mockResolvedValueOnce(config);
            mockAxios.post.mockResolvedValueOnce({
                data: { results: [] }
            });

            const request = createMockRequest("test-repo", "path1/file.txt");
            await runWorker(context, request);

            const aqlCall = mockAxios.post.mock.calls[0];
            const query = aqlCall[1];
            
            expect(query).toContain('"$or"');
            expect(query).toContain('"$match":"path1*"');
            expect(query).toContain('"$match":"path2*"');
        });
    });
});

// Helper function to create mock requests
function createMockRequest(repoKey: string, path: string): BeforeUploadRequest {
    return {
        metadata: {
            repoPath: {
                key: repoKey,
                path: path,
                id: `${repoKey}:${path}`,
                isRoot: false,
                isFolder: false
            },
            contentLength: 1166,
            lastModified: Date.now(),
            trustServerChecksums: true,
            disableRedirect: true,
            repoType: 1,
            servletContextUrl: "",
            skipJarIndexing: false
        },
        userContext: {
            id: "jffe@test/users/testuser",
            realm: "test-realm",
            isToken: true
        },
        headers: {},
        artifactProperties: {}
    };
}