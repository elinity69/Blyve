import os
from litellm import completion

os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = r"C:\Users\naksch\AppData\Roaming\gcloud\application_default_credentials.json"

resp = completion(
    model="vertex_ai/gemini-2.5-flash",
    messages=[{"role": "user", "content": "Sag nur hallo"}],
    vertex_project="project-6f2f73ef-798c-4cfb-a32",
    vertex_location="us-central1",
)

print(resp)
