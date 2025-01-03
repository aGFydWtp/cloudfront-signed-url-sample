import {
	ListObjectsV2Command,
	type ListObjectsV2CommandOutput,
	S3Client,
} from "@aws-sdk/client-s3";
import {
	GetSecretValueCommand,
	SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { getSignedUrl } from "aws-cloudfront-sign";
import { Hono } from "hono";
import { type LambdaEvent, handle } from "hono/aws-lambda";
import { jsxRenderer } from "hono/jsx-renderer";
import { logger } from "hono/logger";
import { Layout } from "./Layout";

type Bindings = {
	event: LambdaEvent;
};

declare module "hono" {
	interface ContextRenderer {
		// biome-ignore lint/style/useShorthandFunctionType: <explanation>
		(
			content: string | Promise<string>,
			head: { title: string; description: string },
		): Response;
	}
}
const app = new Hono<{ Bindings: Bindings }>();

app.use(logger());

app.use(
	jsxRenderer(({ children, title, description }) => (
		<Layout title={title} description={description}>
			{children}
		</Layout>
	)),
);

// search params key を受け取って、そのファイルの signed url を返す
app.get("/api/signed-url", async (c) => {
	const { HOST_NAME, PRIVATE_SECRET_NAME, CF_KEY_PAIR_ID, CF_EXPIRATION } =
		process.env;

	if (!HOST_NAME || !PRIVATE_SECRET_NAME || !CF_KEY_PAIR_ID) {
		return c.text("必要な環境変数が設定されていません。", 500);
	}

	const searchParams = c.env.event?.queryStringParameters;
	const key = searchParams?.key;
	if (!key) {
		return c.text("key が必要です。", 400);
	}

	const expiration = CF_EXPIRATION ? Number(CF_EXPIRATION) : 3600;
	const expireTime = Date.now() + expiration * 1000;

	const secret = new SecretsManagerClient();
	const secretValue = await secret.send(
		new GetSecretValueCommand({ SecretId: PRIVATE_SECRET_NAME }),
	);
	const privateKey = secretValue.SecretString?.replace(/\\n/g, "\n");

	if (!privateKey) {
		return c.text("秘密鍵の取得に失敗しました。", 500);
	}

	// key の先頭が / で始まる場合は削除
	const url = `https://${HOST_NAME}/${encodeURIComponent(key.startsWith("/") ? key.slice(1) : key)}`;
	console.log("url:", url);
	const signedUrl = getSignedUrl(url, {
		keypairId: CF_KEY_PAIR_ID,
		privateKeyString: privateKey,
		expireTime,
	});

	return c.html(`
		<a href="${signedUrl}" target="_blank" class="text-blue-600 underline hover:text-blue-800">
			Open Signed URL
		</a>
	`);
});

// CSSセレクターとして安全な文字列に変換する関数
function cssEscape(value: string) {
	return value.replace(/[ !"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~]/g, "-");
}

app.get("/", async (c) => {
	const { BUCKET, BASE_PATH } = process.env;

	if (!BUCKET) {
		return c.text("必要な環境変数が設定されていません。", 500);
	}

	const s3 = new S3Client({ region: "us-east-1" });
	let objects: ListObjectsV2CommandOutput["Contents"] = [];
	try {
		const listCommand = new ListObjectsV2Command({
			Bucket: BUCKET,
			Prefix: BASE_PATH || undefined,
		});
		const result = await s3.send(listCommand);
		objects = result.Contents || [];
	} catch (err) {
		return c.text(`S3のファイル一覧取得に失敗しました: ${err}`, 500);
	}

	return c.render(
		<div className="container mx-auto p-4">
			<h1 className="text-2xl font-bold mb-4">S3 File List</h1>
			<div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
				{objects.map((obj) => {
					const key = obj.Key;
					// ファイル名がないもの、ディレクトリのものは除外
					if (!key || key.endsWith("/")) return null;

					return (
						<div
							key={key}
							className="bg-white shadow-md rounded p-4 flex flex-col justify-between"
						>
							<div>
								<h2 className="text-lg font-semibold">{key}</h2>
							</div>
							<div className="mt-2">
								<button
									type="button"
									className="px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-700"
									hx-get={`/api/signed-url?key=${encodeURIComponent(key)}`}
									hx-target={`#file-${cssEscape(key)}`}
								>
									Get Signed URL
								</button>
							</div>
							<div id={`file-${cssEscape(key)}`} className="mt-2" />
						</div>
					);
				})}
			</div>
		</div>,
		{
			title: "S3 File List",
			description: "CloudFront Signed URL のデモ",
		},
	);
});

export const handler = handle(app);
