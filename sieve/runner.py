"""Run a job file exported from the GUI on a local or Colab model, then import the results file.

    # Colab GPU (HuggingFace transformers)
    python -m sieve run job.json --backend hf --model Qwen/Qwen3-8B [--4bit]

    # Any OpenAI-compatible server: Ollama, LM Studio, mlx_lm.server (Mac), vLLM
    python -m sieve run job.json --backend openai --base-url http://localhost:11434/v1 --model qwen3:8b

    # The OpenAI API itself (OPENAI_API_KEY in the environment)
    python -m sieve run job.json --backend openai --model gpt-5.5

The job holds the exact prompts and JSON schemas the GUI would send, so results are directly
comparable with copy-paste and API runs. Output: <job>.results.json (resumable: finished items
are skipped when you run the same command again).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path


def extract_json(text: str):
    text = re.sub(r"<think>.*?</think>", "", text or "", flags=re.S)
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, flags=re.S)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    dec = json.JSONDecoder()
    for i, c in enumerate(text):
        if c == "{":
            try:
                return dec.raw_decode(text[i:])[0]
            except json.JSONDecodeError:
                continue
    raise ValueError("no JSON object in model output")


class OpenAICompatible:
    def __init__(self, model, base_url=None, api_key=None, max_tokens=4000, timeout=300, no_think=True):
        from openai import OpenAI  # pip install openai

        self.client = OpenAI(api_key=api_key or os.getenv("OPENAI_API_KEY") or "not-needed", base_url=base_url, timeout=timeout, max_retries=1)
        self.model, self.max_tokens, self.native = model, max_tokens, base_url is None
        self.no_think = no_think and "qwen3" in model.lower()

    def __call__(self, system, prompt, schema, name):
        if self.native:  # api.openai.com: Responses API with a strict schema
            r = self.client.responses.create(model=self.model, input=[{"role": "system", "content": system}, {"role": "user", "content": prompt}],
                                              text={"format": {"type": "json_schema", "name": name, "strict": True, "schema": schema}},
                                              max_output_tokens=16000)
            return extract_json(r.output_text)
        sysmsg = f"{system}\n/no_think" if self.no_think else system
        msgs = [{"role": "system", "content": sysmsg}, {"role": "user", "content": prompt}]
        last = None
        for rf in ({"type": "json_schema", "json_schema": {"name": name, "strict": True, "schema": schema}}, {"type": "json_object"}, None):
            try:
                kw = {"model": self.model, "messages": msgs, "temperature": 0, "max_tokens": self.max_tokens}
                if rf:
                    kw["response_format"] = rf
                r = self.client.chat.completions.create(**kw)
                return extract_json(r.choices[0].message.content or "")
            except Exception as e:  # server does not support this response_format: try the next
                last = e
        raise RuntimeError(last)


class HuggingFace:
    def __init__(self, model, four_bit=False, max_new_tokens=3000):
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        kw = {"device_map": "auto", "torch_dtype": "auto"}
        if four_bit:
            from transformers import BitsAndBytesConfig

            kw["quantization_config"] = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_compute_dtype=torch.float16)
        self.tok = AutoTokenizer.from_pretrained(model)
        self.model = AutoModelForCausalLM.from_pretrained(model, **kw)
        self.max_new_tokens = max_new_tokens

    def __call__(self, system, prompt, schema, name):
        msgs = [{"role": "system", "content": f"{system}\nReturn only JSON matching this schema:\n{json.dumps(schema)}"},
                {"role": "user", "content": prompt}]
        try:
            text = self.tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=False)
        except TypeError:
            text = self.tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
        inputs = self.tok(text, return_tensors="pt").to(self.model.device)
        out = self.model.generate(**inputs, max_new_tokens=self.max_new_tokens, do_sample=False, pad_token_id=self.tok.eos_token_id)
        return extract_json(self.tok.decode(out[0][inputs.input_ids.shape[1]:], skip_special_tokens=True))


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(prog="sieve run", description="Execute a GUI job file on a local/Colab model.")
    ap.add_argument("job")
    ap.add_argument("--backend", choices=["hf", "openai"], required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--base-url", default=None, help="OpenAI-compatible server, e.g. http://localhost:11434/v1")
    ap.add_argument("--4bit", dest="four_bit", action="store_true", help="hf: load in 4-bit (T4 GPUs)")
    ap.add_argument("--out", default=None)
    ap.add_argument("--limit", type=int, default=None)
    a = ap.parse_args(argv)

    job = json.loads(Path(a.job).read_text(encoding="utf-8"))
    if job.get("format") != "srp-job":
        sys.exit("not a job file (format must be 'srp-job')")
    out = Path(a.out or Path(a.job).with_suffix(".results.json"))
    prev = json.loads(out.read_text(encoding="utf-8")) if out.exists() else {}
    results = {k: v for k, v in (prev.get("results") or {}).items() if "_error" not in v}

    model = HuggingFace(a.model, a.four_bit) if a.backend == "hf" else OpenAICompatible(a.model, a.base_url)
    items = [it for it in job["items"] if it["id"] not in results][: a.limit]
    print(f"{len(items)} to run, {len(results)} already done -> {out}")
    for i, it in enumerate(items, 1):
        t = time.time()
        try:
            results[it["id"]] = model(job["system"], it["prompt"], it["schema"], it.get("name", "result"))
            tag = results[it["id"]].get("decision", "ok")
        except Exception as e:
            results[it["id"]] = {"_error": f"{type(e).__name__}: {e}"}
            tag = f"ERROR {e}"
        print(f"[{i}/{len(items)}] {it['id']}: {tag} ({time.time() - t:.0f}s)", flush=True)
        out.write_text(json.dumps({"format": "srp-results", "version": 1, "task": job.get("task"), "run": job.get("run"),
                                   "backend": a.backend, "model": a.model, "results": results}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"done: {out}  -> import it in the GUI (run panel > 'Import results file')")


if __name__ == "__main__":
    main()
