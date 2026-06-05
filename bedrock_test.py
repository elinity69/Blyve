import boto3

client = boto3.client("bedrock-runtime", region_name="eu-central-1")

response = client.converse(
    modelId="eu.anthropic.claude-sonnet-4-6",
    messages=[
        {
            "role": "user",
            "content": [
                {"text": "Write a one-sentence bedtime story about a unicorn."}
            ]
        }
    ]
)

print(response["output"]["message"]["content"][0]["text"])