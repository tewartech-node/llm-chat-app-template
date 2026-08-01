import { AwsClient } from "aws4fetch";
import { Env } from "../types";
import { ActionSpec, Connector, ConnectorActionResult } from "./types";
import { validateAgainstSpec, ok, fail } from "./base";
import { getCredential, hasCredential } from "../vault";

const actions: ActionSpec[] = [
  { name: "s3.uploadObject", requiredParams: ["bucket", "key", "content"] },
  { name: "s3.getObject", requiredParams: ["bucket", "key"] },
  { name: "s3.listObjects", requiredParams: ["bucket"] },
  { name: "s3.deleteObject", requiredParams: ["bucket", "key"], destructive: true },
  { name: "s3.copyObject", requiredParams: ["sourceBucket", "sourceKey", "destBucket", "destKey"] },
  { name: "lambda.invoke", requiredParams: ["functionName"] },
  { name: "logs.getLogEvents", requiredParams: ["logGroup", "logStream"] },
  { name: "logs.createLogStream", requiredParams: ["logGroup", "logStream"] },
];

interface AwsCreds {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

async function getClient(env: Env): Promise<{ client: AwsClient; region: string } | null> {
  const creds = (await getCredential(env, "aws")) as unknown as AwsCreds | null;
  if (!creds?.accessKeyId || !creds?.secretAccessKey) return null;
  return {
    client: new AwsClient({
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      region: creds.region,
    }),
    region: creds.region,
  };
}

export const awsConnector: Connector = {
  name: "aws",
  actions,

  async isAuthenticated(env: Env): Promise<boolean> {
    return hasCredential(env, "aws");
  },

  validateAction(action, params) {
    return validateAgainstSpec(actions, action, params);
  },

  async execute(env: Env, action, params): Promise<ConnectorActionResult> {
    const check = this.validateAction(action, params);
    if (!check.valid) return fail(check.reason ?? "validation failed");

    const auth = await getClient(env);
    if (!auth) return fail("AWS connector not authenticated — call /api/connectors/auth first");
    const { client, region } = auth;

    try {
      switch (action) {
        case "s3.uploadObject": {
          const resp = await client.fetch(
            `https://${params.bucket}.s3.${region}.amazonaws.com/${params.key}`,
            { method: "PUT", body: String(params.content) },
          );
          if (!resp.ok) return fail(`uploadObject failed: ${resp.status} ${await resp.text()}`);
          return ok({ uploaded: true });
        }
        case "s3.getObject": {
          const resp = await client.fetch(
            `https://${params.bucket}.s3.${region}.amazonaws.com/${params.key}`,
          );
          if (!resp.ok) return fail(`getObject failed: ${resp.status} ${await resp.text()}`);
          return ok({ content: await resp.text() });
        }
        case "s3.listObjects": {
          const prefix = params.prefix ? `?prefix=${encodeURIComponent(String(params.prefix))}` : "";
          const resp = await client.fetch(
            `https://${params.bucket}.s3.${region}.amazonaws.com/${prefix}`,
          );
          if (!resp.ok) return fail(`listObjects failed: ${resp.status} ${await resp.text()}`);
          return ok({ xml: await resp.text() });
        }
        case "s3.deleteObject": {
          if (params.confirmed !== true) return fail("deleteObject requires params.confirmed = true");
          const resp = await client.fetch(
            `https://${params.bucket}.s3.${region}.amazonaws.com/${params.key}`,
            { method: "DELETE" },
          );
          if (!resp.ok) return fail(`deleteObject failed: ${resp.status} ${await resp.text()}`);
          return ok({ deleted: true });
        }
        case "s3.copyObject": {
          const resp = await client.fetch(
            `https://${params.destBucket}.s3.${region}.amazonaws.com/${params.destKey}`,
            {
              method: "PUT",
              headers: { "x-amz-copy-source": `/${params.sourceBucket}/${params.sourceKey}` },
            },
          );
          if (!resp.ok) return fail(`copyObject failed: ${resp.status} ${await resp.text()}`);
          return ok({ copied: true });
        }
        case "lambda.invoke": {
          const resp = await client.fetch(
            `https://lambda.${region}.amazonaws.com/2015-03-31/functions/${params.functionName}/invocations`,
            {
              method: "POST",
              headers: {
                "x-amz-invocation-type": params.async ? "Event" : "RequestResponse",
              },
              body: params.payload ? JSON.stringify(params.payload) : undefined,
            },
          );
          if (!resp.ok) return fail(`lambda.invoke failed: ${resp.status} ${await resp.text()}`);
          return ok(await resp.json().catch(() => ({})));
        }
        case "logs.getLogEvents": {
          const resp = await client.fetch(`https://logs.${region}.amazonaws.com/`, {
            method: "POST",
            headers: {
              "content-type": "application/x-amz-json-1.1",
              "x-amz-target": "Logs_20140328.GetLogEvents",
            },
            body: JSON.stringify({
              logGroupName: params.logGroup,
              logStreamName: params.logStream,
              limit: params.limit ?? 50,
            }),
          });
          if (!resp.ok) return fail(`getLogEvents failed: ${resp.status} ${await resp.text()}`);
          return ok(await resp.json());
        }
        case "logs.createLogStream": {
          const resp = await client.fetch(`https://logs.${region}.amazonaws.com/`, {
            method: "POST",
            headers: {
              "content-type": "application/x-amz-json-1.1",
              "x-amz-target": "Logs_20140328.CreateLogStream",
            },
            body: JSON.stringify({
              logGroupName: params.logGroup,
              logStreamName: params.logStream,
            }),
          });
          if (!resp.ok) return fail(`createLogStream failed: ${resp.status} ${await resp.text()}`);
          return ok({ created: true });
        }
        default:
          return fail(`Unhandled action "${action}"`);
      }
    } catch (error) {
      return fail(error instanceof Error ? error.message : "AWS API call failed");
    }
  },
};
