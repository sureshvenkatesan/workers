

## JFrog Workers

JFrog Workers is a service in the JFrog Platform that provides a serverless execution environment.
You can create workers that react to events in the JFrog Platform similar to AWS Lambda services.
Workers service provides more flexibility to accomplish your use cases.
You can use these workers to perform certain tasks that extend the capabilities of the JFrog Platform according to your requirements.

See the full documentation [here](https://jfrog.com/help/r/jfrog-platform-administration-documentation/workers)

## Blog: 
- [Doing DevOps Your Way On SaaS Solutions: Writing Your First JFrog Worker Service to Extend JFrog SaaS](https://jfrog.com/blog/writing-your-first-jfrog-worker-service/)
- [Doing DevOps Your Way On SaaS Solutions: Connecting JFrog CLI to Your JFrog Workers](https://jfrog.com/blog/doing-devops-your-way-on-saas-solutions-connecting-jfrog-cli-to-your-jfrog-workers/)

### Example Workers:
- [JFrog Workers Samples](https://github.com/jfrog/workers-sample)
This repository contains a collection of sample workers for common use cases. Feel free to use, modify, and extend these samples to accomplish your use cases.

- [sv-builddiff-vul-compare](sv-builddiff-vul-compare)
This worker compares security vulnerabilities between two builds using Xray UI API "https://your-instance.jfrog.io/ui/api/v1/xray/ui/security_info/diff"  and generates an HTML report of the differences.

- [Repository Synchronization to Edge](https://github.com/flouis1/jf-repo-sync-to-edge)
This worker synchronizes repositories from a source Artifactory server to a target Artifactory server. It first checks the repositories on the source server using a regular expression, then creates those that do not already exist on the target server.
