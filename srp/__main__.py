"""python -m srp <command> ...

  build-demo   (local only) build demo project files from private project folders
  run          execute a job file exported from the GUI (screening / extraction) on a local or Colab model
  serve        serve the GUI on http://127.0.0.1:8765 with a fetch helper for full texts
"""
import sys


def main() -> None:
    cmd, rest = (sys.argv[1], sys.argv[2:]) if len(sys.argv) > 1 else ("-h", [])
    if cmd == "build-demo":
        try:
            from .build_demo import main as m
        except ImportError:
            sys.exit("build-demo is a local-only tool (srp/build_demo.py is not part of the public repository)")
    elif cmd == "run":
        from .runner import main as m
    elif cmd == "serve":
        from .serve import main as m
    else:
        print(__doc__)
        sys.exit(0 if cmd in ("-h", "--help") else 2)
    m(rest)


if __name__ == "__main__":
    main()
