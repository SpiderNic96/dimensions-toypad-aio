# Repository map

This repository deliberately separates the installable runtime, maintainable source, provenance, and build evidence.

```text
.
├── README.md
├── docs/
│   ├── ARCHITECTURE.md
│   ├── BUILD-ATTEMPT.md
│   ├── LINUX-CODE-LINEAGE.md
│   ├── REPOSITORY-MAP.md
│   └── REPRODUCIBILITY.md
├── release/
│   ├── reference/
│   │   └── dimensions-toypad-AIO-3.3.11.zip
│   └── source/
│       └── dimensions-toypad-SOURCE-3.3.11.zip
├── scripts/
│   └── repack-reference-aio.sh
├── source/
│   ├── plugin/
│   ├── protocol/
│   ├── rpcs3-patch/
│   └── docs/
└── .github/workflows/
    ├── build-plugin.yml
    └── build-rpcs3-appimage.yml
```

The `release/reference` AIO ZIP is the supplied 3.3.11 install artifact. The `source/` tree is the supplied source distribution, copied without deleting its provenance material. The workflows are the reproducible path intended for future source-built releases.
