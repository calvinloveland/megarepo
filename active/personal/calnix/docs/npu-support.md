# Intel NPU & OpenVINO 2024.6 Support

This repository now bundles the Intel OpenVINO 2024.6 toolchain and exposes a reproducible development shell that prepares the runtime, Python bindings, and Intel NPU helpers automatically.

## OpenVINO Development Shell

```bash
nix develop
```

Dropping into the dev shell does the following:

- Downloads and unpacks `l_openvino_toolkit_ubuntu22_2024.6.0.17404.4c0f47d2335_x86_64.tgz` (hash `1h1rmdk9614ni1zi2671icq6d50gpa41cg6wqwly7zwq5v9xkng6`).
- Exposes the toolkit via environment variables so `openvino.runtime.Core()` sees the Intel NPU plugin immediately.
- Stages runtime libraries under `~/.intel_npu` by symlinking the extracted `runtime/` tree (safe to re-run and idempotent).
- Runs a Python probe to confirm the NPU appears in `Core().available_devices`, failing fast if it does not (use `CALNIX_SKIP_NPU_CHECK=1` to bypass during CI or on unsupported hosts).

## System-Wide Runtime (1337book)

The `1337book` host enables `calnix.openvino.enable = true`, which installs the exact same OpenVINO 2024.6 runtime globally and wires it into `/etc/profile.d/openvino.sh` and `/etc/fish/conf.d/openvino.fish`. As a result:

- `python3 -c "from openvino.runtime import Core; print(Core().available_devices)"` works in any shell without `nix develop`.
- `INTEL_OPENVINO_DIR`, `IE_PLUGINS_PATH`, `INTEL_NPU_DEVICE`, `PYTHONPATH`, `PKG_CONFIG_PATH`, and `LD_LIBRARY_PATH` are exported automatically for every login.
- `INTEL_NPU_HOME` is populated under each user’s `~/.intel_npu` with symlinks to the runtime libraries/share tree.
- `LD_LIBRARY_PATH` also prepends the nixpkgs `level-zero` loader (installed under `/nix/store/*-level-zero-*/lib`), guaranteeing that `libze_loader.so.1` matches the rest of the OpenVINO 2024.6 stack even if the base OS does not ship Intel’s loader.

If you want to disable the automatic wiring temporarily, unset `calnix.openvino.enable` for your host and rebuild.

### Key Environment Variables

| Variable | Description |
| --- | --- |
| `INTEL_OPENVINO_DIR` / `OpenVINO_DIR` | Absolute path to the unpacked OpenVINO 2024.6 toolkit inside the Nix store. |
| `IE_PLUGINS_PATH` | Points at `runtime/lib/intel64` so the Intel NPU plugin is discoverable. |
| `LD_LIBRARY_PATH` | Prepended with OpenVINO runtime, TBB, and HDDL libs. |
| `PKG_CONFIG_PATH` | Prepended with OpenVINO pkg-config files for downstream builds. |
| `PYTHONPATH` | Includes the toolkit’s `python/` directory so the bundled `openvino` module works with Python 3.12. |
| `INTEL_NPU_DEVICE` | Defaults to `NPU`; override to target other enumerated accelerators. |
| `INTEL_NPU_HOME` | Ensures `~/.intel_npu` holds stable symlinks to runtime assets. |

## Intel NPU Kernel Driver Helper

All hosts now ship the `intel-npu-driver-helper` wrapper (from `modules/base.nix`). It clones Intel’s official driver repo and lets you run the supported installer without memorizing commands:

```bash
# Show detected xe/intel_npu modules and repo path
intel-npu-driver-helper --status

# Install or uninstall kernel drivers (sudo required)
intel-npu-driver-helper --install
intel-npu-driver-helper --uninstall
```

The helper mirrors `https://github.com/intel/linux-npu-driver` under `${XDG_CACHE_HOME:-$HOME/.cache}/intel-linux-npu-driver` so you can inspect or run `drivers/setup.sh` manually if needed.

## Verifying Availability

The dev shell runs this probe automatically, but you can repeat it any time after boot or after updating drivers:

```bash
nix develop --command python3 - <<'PY'
from openvino.runtime import Core
core = Core()
devices = core.available_devices
print(devices)
assert "NPU" in devices, "Intel NPU is not visible"
PY
```

If the assertion fails, double-check that:

1. `intel-npu-driver-helper --install` completed successfully and the `xe` / `intel_npu` modules are loaded (`lsmod | grep -E '^(xe|intel_npu)'`).
2. Firmware is up to date via `fwupdmgr` (already enabled for 1337book).
3. You are not intentionally skipping the probe via `CALNIX_SKIP_NPU_CHECK`.

## Handling `ZE_RESULT_ERROR_UNSUPPORTED_FEATURE`

This Level Zero error always originates inside the Intel NPU runtime when the plugin attempts to compile a graph. Swapping ML frontends (Keras, PyTorch, ONNX, raw IR) does not change that code path, so the failure must be resolved at the driver/runtime layer. Work through the following before blaming the higher-level framework:

1. **Match toolkit + firmware** – Install the NPU-enabled OpenVINO bundle (see the download instructions in the repo root) and re-run `sudo ./drivers/setup.sh install` from that bundle *after* every kernel upgrade. A reboot is required once the installer updates `xe`/`intel_npu`.
2. **Verify Level Zero visibility** – Run `sycl-ls` and `oneapi-cli --list` from `${INTEL_OPENVINO_DIR}/runtime/bin/intel64/Release`. Both tools must list the NPU alongside the CPU; if they do not, Level Zero cannot discover the device and the plugin will raise the same error for all models. The shell profile always prepends the nixpkgs `level-zero` library path to `LD_LIBRARY_PATH`, so `libze_loader.so.1` is present even on hosts that do not ship Intel’s loader out of the box.
3. **Confirm environment wiring** – `calnix.openvino.enable = true;` populates `/etc/profile.d/openvino.sh` and the fish equivalent, exporting `INTEL_OPENVINO_DIR`, `LD_LIBRARY_PATH`, `PKG_CONFIG_PATH`, `PYTHONPATH`, and `IE_PLUGINS_PATH`. Ensure you are in a login shell (or `nix develop`) so these variables are present before running `benchmark_app` or `core.compile_model(..., 'NPU')`.
4. **Run a minimal OpenVINO sample** – Use `benchmark_app -m $INTEL_OPENVINO_DIR/models/ir/public/squeezenet1.1/FP16/squeezenet1.1.xml -d NPU`. Success here proves the runtime stack works; only then will higher-level frameworks (Keras, PyTorch, MancalaAI) succeed because they ultimately call the same `Core.compile_model(..., "NPU")` entry point.

Once the sample graph compiles on the NPU, re-run MancalaAI. The device list should show `['CPU', 'NPU']`, and `core.compile_model(..., 'NPU')` will reuse the trusted runtime without triggering `ZE_RESULT_ERROR_UNSUPPORTED_FEATURE`.

## Troubleshooting Tips

- Use `sudo dmesg | grep -i npu` for low-level driver logs.
- When testing kernels, re-run `intel-npu-driver-helper --install` after each kernel upgrade to rebuild DKMS modules.
- Set `CALNIX_SKIP_NPU_CHECK=1` temporarily if you need to work on non-NPU hardware but still want access to the OpenVINO toolchain.
