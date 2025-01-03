import * as cdk from "aws-cdk-lib";
import type { PublicKey } from "aws-cdk-lib/aws-cloudfront";
import { FunctionUrlAuthType, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import type { Bucket } from "aws-cdk-lib/aws-s3";
import type { Secret } from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";

interface Props extends cdk.StackProps {
  secret: Secret;
  bucket: Bucket;
  publicKey: PublicKey;
  hostName: string;
}

export class BucketListViewerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    const fn = new NodejsFunction(this, "Lambda", {
      entry: "lambda/index.tsx",
      handler: "handler",
      runtime: Runtime.NODEJS_20_X,
      environment: {
        BUCKET: props.bucket.bucketName,
        HOST_NAME: props.hostName,
        PRIVATE_SECRET_NAME: props.secret.secretName,
        CF_KEY_PAIR_ID: props.publicKey.publicKeyId,
      },
    });
    const functionUrl = fn.addFunctionUrl({
      authType: FunctionUrlAuthType.NONE,
    });

    props.bucket.grantRead(fn);
    props.secret.grantRead(fn);

    new cdk.CfnOutput(this, "FunctionUrl", {
      value: functionUrl.url,
    });
  }
}
