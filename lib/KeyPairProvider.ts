import {
	CustomResource,
	Duration,
	Fn,
	RemovalPolicy,
	SecretValue,
} from "aws-cdk-lib";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import {
	CustomDataIdentifier,
	DataProtectionPolicy,
	LogGroup,
	RetentionDays,
} from "aws-cdk-lib/aws-logs";
import { Provider } from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";

const rsaPrivateKeyPattern =
	".+?-----BEGIN RSA PRIVATE KEY-----(.|\n)+?-----END RSA PRIVATE KEY-----.+?";

export class KeyPairProvider extends Construct {
	constructor(scope: Construct, id: string) {
		super(scope, id);

		// 公開鍵と秘密鍵を生成する実装。provider framework利用時に開発者が唯一実装する必要があるコード
		const handler = new NodejsFunction(this, "Handler", {
			runtime: Runtime.NODEJS_LATEST,
			entry: `${__dirname}/KeyPairProvider/keypairGenerator.ts`,
			handler: "handler",
			timeout: Duration.seconds(30),
			logGroup: new LogGroup(this, "HandlerLog", {
				removalPolicy: RemovalPolicy.DESTROY,
				retention: RetentionDays.ONE_DAY,
			}),
		});

		// 自分で実装したLambda関数とCloudFormationのカスタムリソースの仕様の間を取り持ってくれるリソース。Provider Frameworkの肝
		const provider = new Provider(this, "Provider", {
			onEventHandler: handler,
			logGroup: new LogGroup(this, "ProviderLog", {
				removalPolicy: RemovalPolicy.DESTROY,
				retention: RetentionDays.ONE_DAY,
				dataProtectionPolicy: new DataProtectionPolicy({
					identifiers: [
						new CustomDataIdentifier("RSAPrivateKey", rsaPrivateKeyPattern),
					],
				}),
			}),
		});

		// カスタムリソース本体
		const resource = new CustomResource(this, "KeyPair2", {
			serviceToken: provider.serviceToken,
			removalPolicy: RemovalPolicy.DESTROY,
		});

		// L3コントラクトのプロパティとして、カスタムリソースのattributeを公開する
		this._keyPairName = resource.node.id;
		this._publicKey = resource.getAttString("publicKey");

		// 秘密鍵は生のテキストではなく、SecretValueとして公開する
		const privateKeyString = resource.getAttString("privateKey");
		this._privateKey = SecretValue.unsafePlainText(privateKeyString);

		// Seacrets ManagerにJSON形式で登録するための値を提供する（改行コードは\nにエスケープしておく必要がある）
		this._privateKeyAsJsonString = SecretValue.unsafePlainText(
			Fn.join("\\n", Fn.split("\n", privateKeyString)),
		);
	}

	private readonly _keyPairName: string;
	private readonly _publicKey: string;
	private readonly _privateKey: SecretValue;
	private readonly _privateKeyAsJsonString: SecretValue;

	public get keyPairName() {
		return this._keyPairName;
	}
	public get publicKey() {
		return this._publicKey;
	}
	public get privateKey() {
		return this._privateKey;
	}
	public get privateKeyAsJsonString() {
		return this._privateKeyAsJsonString;
	}
}
