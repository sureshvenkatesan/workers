import { PlatformContext, PlatformClients, PlatformHttpClient } from 'jfrog-workers';
import { AfterBuildInfoSaveRequest } from './types';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import runWorker from './worker';

describe("sv-builddiff-vul-compare tests", () => {
    let context: DeepMocked<PlatformContext>;
    let request: DeepMocked<AfterBuildInfoSaveRequest>;

    beforeEach(() => {
        context = createMock<PlatformContext>({
            clients: createMock<PlatformClients>({
                platformHttp: createMock<PlatformHttpClient>({
                    get: jest.fn().mockResolvedValue({ status: 200 })
                })
            })
        });
        request = createMock<AfterBuildInfoSaveRequest>();
    })

    it('should run', async () => {
        await expect(runWorker(context, request)).resolves.toEqual(expect.objectContaining({
            message: expect.anything(),
        }))
    })
});