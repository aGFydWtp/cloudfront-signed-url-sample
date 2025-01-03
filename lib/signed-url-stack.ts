import * as cdk from "aws-cdk-lib";
import { Duration } from "aws-cdk-lib";
import type { ICertificate } from "aws-cdk-lib/aws-certificatemanager";
import {
  CfnOriginAccessControl,
  Distribution,
  KeyGroup,
  PublicKey,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { S3Origin } from "aws-cdk-lib/aws-cloudfront-origins";
import { Effect, PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { ARecord, HostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";
import { BlockPublicAccess, Bucket } from "aws-cdk-lib/aws-s3";
import { BucketDeployment } from "aws-cdk-lib/aws-s3-deployment";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";
import { KeyPairProvider } from "./KeyPairProvider";

interface Props extends cdk.StackProps {
  customDomainSetting: {
    cert: ICertificate;
    hostName: string;
    domainName: string;
    hostedZoneId: string;
  } | null;
  s3OriginAccessControlId: string;
}

export class CloudFrontSignedUrlStack extends cdk.Stack {
  public readonly secret: Secret;
  public readonly bucket: Bucket;
  public readonly publicKey: PublicKey;
  public readonly distribution: Distribution;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    const bucket = new Bucket(this, "Bucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    this.bucket = bucket;

    new BucketDeployment(this, "S3Assets", {
      sources: [cdk.aws_s3_deployment.Source.asset("assets")],
      destinationBucket: bucket,
    });

    /* ============================================================
      KeyPairProvider
    ============================================================ */
    const keyPairProvider = new KeyPairProvider(this, "KeyPairProvider");
    const privateSecret = new Secret(this, "PrivateSecret", {
      secretName: "CloudFrontSignedUrlSecret",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      secretStringValue: keyPairProvider.privateKeyAsJsonString,
    });
    this.secret = privateSecret;

    const publicKey = new PublicKey(this, "PublicKey", {
      encodedKey: keyPairProvider.publicKey,
      comment: "CloudFront Signed URL用の公開鍵",
    });
    this.publicKey = publicKey;

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
        origin: new S3Origin(bucket),
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
    this.distribution = distribution;

    const cfnDistribution = distribution.node
      .defaultChild as cdk.aws_cloudfront.CfnDistribution;

    // OAI削除（勝手に設定されるため）
    cfnDistribution.addPropertyOverride(
      "DistributionConfig.Origins.0.S3OriginConfig.OriginAccessIdentity",
      "",
    );

    // Set OAC
    let oacId: string | null = props.s3OriginAccessControlId ?? null;
    if (!oacId) {
      const oac = new CfnOriginAccessControl(this, "OAC", {
        originAccessControlConfig: {
          name: "CloudFrontSignedUrlOAC",
          signingBehavior: "always",
          signingProtocol: "sigv4",
          originAccessControlOriginType: "s3",
        },
      });
      oacId = oac.attrId;
    }
    cfnDistribution.addPropertyOverride(
      "DistributionConfig.Origins.0.OriginAccessControlId",
      oacId,
    );

    /* ============================================================
      DNS record for custom domain
    ============================================================ */
    if (props.customDomainSetting) {
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
  }
}
