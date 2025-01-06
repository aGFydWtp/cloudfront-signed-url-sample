import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import type { ICertificate } from "aws-cdk-lib/aws-certificatemanager";
import {
  Distribution,
  KeyGroup,
  PublicKey,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { Effect, PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { FunctionUrlAuthType, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { ARecord, HostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";
import { BlockPublicAccess, Bucket } from "aws-cdk-lib/aws-s3";
import { BucketDeployment } from "aws-cdk-lib/aws-s3-deployment";
import { Source } from "aws-cdk-lib/aws-s3-deployment";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";
import { KeyPairProvider } from "./KeyPairProvider";

interface Props extends StackProps {
  customDomainSetting: {
    cert: ICertificate;
    hostName: string;
    domainName: string;
    hostedZoneId: string;
  } | null;
  enableSimpleViewer?: boolean;
}

export class CloudFrontSignedUrlStack extends Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    const bucket = new Bucket(this, "Bucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    });

    new BucketDeployment(this, "S3Assets", {
      sources: [Source.asset("assets")],
      destinationBucket: bucket,
    });

    /* ============================================================
      KeyPairProvider
    ============================================================ */
    const keyPairProvider = new KeyPairProvider(this, "KeyPairProvider");
    const privateSecret = new Secret(this, "PrivateSecret", {
      secretName: "CloudFrontSignedUrlSecret",
      removalPolicy: RemovalPolicy.DESTROY,
      secretStringValue: keyPairProvider.privateKeyAsJsonString,
    });

    const publicKey = new PublicKey(this, "PublicKey", {
      encodedKey: keyPairProvider.publicKey,
      comment: "CloudFront Signed URL用の公開鍵",
    });

    const keyGroup = new KeyGroup(this, "KeyGroup", {
      items: [publicKey],
      comment: "Signed URL用のKeyGroup",
    });

    const distribution = new Distribution(this, "Distribution", {
      certificate: props.customDomainSetting?.cert,
      domainNames: props.customDomainSetting
        ? [
            `${props.customDomainSetting.hostName}.${props.customDomainSetting.domainName}`,
          ]
        : undefined,
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(bucket),
        trustedKeyGroups: [keyGroup],
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 403,
          responsePagePath: "/error403.html",
          ttl: Duration.seconds(30),
        },
      ],
    });

    if (props.customDomainSetting) {
      /* ============================================================
      DNS record for custom domain
    ============================================================ */
      const { hostedZoneId, domainName, hostName } = props.customDomainSetting;
      const hostedZone = HostedZone.fromHostedZoneAttributes(
        this,
        "HostedZone",
        { hostedZoneId, zoneName: domainName },
      );
      new ARecord(this, "ARecord", {
        zone: hostedZone,
        recordName: hostName,
        target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
      });
    }

    /* ============================================================
      S3 bucket policy
    ============================================================ */
    const contentsBucketPolicyStatement = new PolicyStatement({
      actions: ["s3:GetObject"],
      effect: Effect.ALLOW,
      principals: [new ServicePrincipal("cloudfront.amazonaws.com")],
      resources: [`${bucket.bucketArn}/*`],
    });
    contentsBucketPolicyStatement.addCondition("StringEquals", {
      "AWS:SourceArn": `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
    });
    bucket.addToResourcePolicy(contentsBucketPolicyStatement);

    /* ============================================================
      Bucket List Viewer & Get Signed URL
    ============================================================ */
    if (props.enableSimpleViewer) {
      const hostName = props.customDomainSetting
        ? `${props.customDomainSetting.hostName}.${props.customDomainSetting.domainName}`
        : distribution.domainName;
      const fn = new NodejsFunction(this, "Lambda", {
        entry: "lambda/index.tsx",
        handler: "handler",
        runtime: Runtime.NODEJS_20_X,
        environment: {
          BUCKET: bucket.bucketName,
          HOST_NAME: hostName,
          PRIVATE_SECRET_NAME: privateSecret.secretName,
          CF_KEY_PAIR_ID: publicKey.publicKeyId,
        },
      });
      const functionUrl = fn.addFunctionUrl({
        authType: FunctionUrlAuthType.NONE,
      });

      bucket.grantRead(fn);
      privateSecret.grantRead(fn);

      new CfnOutput(this, "FunctionUrl", {
        value: functionUrl.url,
      });
    }
  }
}
