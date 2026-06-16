import os
from litellm import completion

os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = r"C:\Users\naksch\Desktop\Blyve\Blyve\google-credentials.json"
os.environ["VERTEXAI_PROJECT"] = "project-6f2f73ef-798c-4cfb-a32"
os.environ["VERTEXAI_LOCATION"] = "global"

resp = completion(
    model="vertex_ai/gemini-3.1-pro-preview",
    messages=[{"role": "user", "content": "Sag nur: test ok"}],
)

print(resp.choices[0].message.content)
