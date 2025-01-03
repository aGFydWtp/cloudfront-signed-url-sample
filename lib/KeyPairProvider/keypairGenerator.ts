import { generateKeyPairSync } from "crypto";
import type { CdkCustomResourceHandler } from "aws-lambda";

export const handler: CdkCustomResourceHandler = async (event, context) => {
  const stackName = event.StackId.split("/")[1];
  switch (event.RequestType) {
    case "Create": {
      // リソース生成時に公開鍵と秘密鍵を生成する
      const { publicKey, privateKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: {
          type: "pkcs1",
          format: "pem",
        },
        privateKeyEncoding: {
          type: "pkcs1",
          format: "pem",
        },
      });
      // リソースのattributeとして返す
      return {
        Data: { publicKey, privateKey },
      };
    }

    case "Update":
      return {};

    case "Delete":
      return {};
  }
};
