# -*- coding: utf-8 -*-
import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
    base_url=os.getenv("OPENAI_BASE_URL"),
)

resp = client.chat.completions.create(
    model=os.getenv("OPENAI_MODEL"),
    messages=[{"role": "user", "content": "Sag nur: test ueber proxy"}],
)

print(resp.choices[0].message.content)
