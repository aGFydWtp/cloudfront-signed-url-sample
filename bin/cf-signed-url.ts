#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import type { ICertificate } from "aws-cdk-lib/aws-certificatemanager";
import { BucketListViewerStack } from "../lib/bucket-list-viewer-stack";
import { CloudFrontCertStack } from "../lib/cloud-front-cert-stack";
import { CloudFrontSignedUrlStack } from "../lib/signed-url-stack";

const app = new cdk.App();

// get environment
const argContext = "environment";
const envKey = app.node.tryGetContext(argContext);
if (envKey === undefined) {
	throw new Error(
		`Please specify environment with context option. ex) cdk deploy -c ${argContext}=dev`,
	);
}
const envValues = app.node.tryGetContext(envKey);
if (envValues === undefined) {
	throw new Error("Invalid environment.");
}

const { hostName, domainName, hostedZoneId } = envValues;

let cloudFrontCertStack: CloudFrontCertStack | null = null;
let customDomainSetting: {
	cert: ICertificate;
	hostName: string;
	domainName: string;
	hostedZoneId: string;
} | null = null;

if (hostName && domainName && hostedZoneId) {
	cloudFrontCertStack = new CloudFrontCertStack(
		app,
		`${envKey}CloudFrontCertStack`,
		{
			env: { account: envValues.awsAccountId, region: "us-east-1" },
			hostName,
			domainName,
			hostedZoneId,
		},
	);
	const cert = cloudFrontCertStack.cert;
	customDomainSetting = { cert, hostName, domainName, hostedZoneId };
}

const signedUrlStack = new CloudFrontSignedUrlStack(
	app,
	`${envKey}CloudFrontSignedUrlStack`,
	{
		env: { account: envValues.awsAccountId, region: "us-east-1" },
		customDomainSetting,
		s3OriginAccessControlId: envValues.s3OriginAccessControlId,
	},
);

new BucketListViewerStack(app, `${envKey}BucketListViewerStack`, {
	env: { account: envValues.awsAccountId, region: "us-east-1" },
	secret: signedUrlStack.secret,
	bucket: signedUrlStack.bucket,
	publicKey: signedUrlStack.publicKey,
	hostName: signedUrlStack.distribution.domainName,
});
