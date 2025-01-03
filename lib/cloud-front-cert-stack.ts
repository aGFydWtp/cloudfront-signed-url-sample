import * as cdk from "aws-cdk-lib";
import {
  Certificate,
  CertificateValidation,
  type ICertificate,
} from "aws-cdk-lib/aws-certificatemanager";
import { HostedZone } from "aws-cdk-lib/aws-route53";
import type { Construct } from "constructs";

interface CloudFrontCertStackProps extends cdk.StackProps {
  hostName: string;
  domainName: string;
  hostedZoneId: string;
}

export class CloudFrontCertStack extends cdk.Stack {
  public readonly cert: ICertificate;

  constructor(scope: Construct, id: string, props: CloudFrontCertStackProps) {
    super(scope, id, props);

    /* ============================================================
      Certificate
    ============================================================ */

    const hostedZone = HostedZone.fromHostedZoneAttributes(this, "HostedZone", {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.domainName,
    });
    const cert = new Certificate(this, "Cert", {
      domainName: `${props.hostName}.${props.domainName}`,
      validation: CertificateValidation.fromDns(hostedZone),
    });

    this.cert = cert;
  }
}
