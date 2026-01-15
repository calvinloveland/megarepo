{ config, pkgs, lib, inputs, ... }:

let
  cfg = config.calnix.openvino;
  inherit (lib) mkEnableOption mkIf attrByPath mkAfter;
  inherit (lib.asserts) assertMsg;
in
{
  options.calnix.openvino.enable = mkEnableOption "system-wide Intel OpenVINO 2024.6 runtime";

  config = mkIf cfg.enable (
    let
      system = pkgs.stdenv.hostPlatform.system;
      openvinoRuntime = attrByPath [ system "openvino-runtime" ] null inputs.self.packages;
      _ = assertMsg (openvinoRuntime != null) "OpenVINO runtime is not available for ${system}";
      openvinoLibDir = "${openvinoRuntime}/runtime/lib/intel64";
      openvinoPkgConfigDir = "${openvinoRuntime}/runtime/lib/pkgconfig";
      openvinoPythonDir = "${openvinoRuntime}/python";
      openvinoTbbDir = "${openvinoRuntime}/runtime/3rdparty/tbb/lib";
      openvinoHddlDir = "${openvinoRuntime}/runtime/3rdparty/hddl/lib";
      levelZero = pkgs.level-zero;
      levelZeroLibDir = "${levelZero}/lib";
      openvinoShareDir = "${openvinoRuntime}/runtime/share";
      toolchainLibDir = "${pkgs.stdenv.cc.cc.lib}/lib";
      posixProfile = ''
# Intel OpenVINO 2024.6 system profile
export INTEL_OPENVINO_DIR=${openvinoRuntime}
export OpenVINO_DIR="$INTEL_OPENVINO_DIR"
export OpenVINO_VERSION="2024.6"
export IE_PLUGINS_PATH=${openvinoLibDir}
[ -n "''${INTEL_NPU_DEVICE:-}" ] || INTEL_NPU_DEVICE="NPU"
export INTEL_NPU_DEVICE

_calnix_openvino_prepend_ldpath() {
  value="$1"
  [ -e "$value" ] || return
  case ":''${LD_LIBRARY_PATH:-}:" in
    *":$value:"*) return ;;
  esac
  if [ -n "''${LD_LIBRARY_PATH:-}" ]; then
    export LD_LIBRARY_PATH="$value:$LD_LIBRARY_PATH"
  else
    export LD_LIBRARY_PATH="$value"
  fi
}

_calnix_openvino_prepend_pkgconfig() {
  value="$1"
  [ -e "$value" ] || return
  case ":''${PKG_CONFIG_PATH:-}:" in
    *":$value:"*) return ;;
  esac
  if [ -n "''${PKG_CONFIG_PATH:-}" ]; then
    export PKG_CONFIG_PATH="$value:$PKG_CONFIG_PATH"
  else
    export PKG_CONFIG_PATH="$value"
  fi
}

_calnix_openvino_prepend_python() {
  value="$1"
  [ -e "$value" ] || return
  case ":''${PYTHONPATH:-}:" in
    *":$value:"*) return ;;
  esac
  if [ -n "''${PYTHONPATH:-}" ]; then
    export PYTHONPATH="$value:$PYTHONPATH"
  else
    export PYTHONPATH="$value"
  fi
}

_calnix_openvino_prepend_ldpath ${openvinoLibDir}
_calnix_openvino_prepend_ldpath ${openvinoTbbDir}
_calnix_openvino_prepend_ldpath ${openvinoHddlDir}
_calnix_openvino_prepend_ldpath ${levelZeroLibDir}
_calnix_openvino_prepend_ldpath ${toolchainLibDir}
_calnix_openvino_prepend_pkgconfig ${openvinoPkgConfigDir}
_calnix_openvino_prepend_python ${openvinoPythonDir}

if [ -n "''${HOME:-}" ]; then
  export INTEL_NPU_HOME="$HOME/.intel_npu"
  mkdir -p "$INTEL_NPU_HOME"
  ln -sfn ${openvinoLibDir} "$INTEL_NPU_HOME/lib"
  ln -sfn ${openvinoShareDir} "$INTEL_NPU_HOME/share"
fi

unset -f _calnix_openvino_prepend_ldpath
unset -f _calnix_openvino_prepend_pkgconfig
unset -f _calnix_openvino_prepend_python
'';

      fishProfile = ''
# Intel OpenVINO 2024.6 fish profile
set -gx INTEL_OPENVINO_DIR ${openvinoRuntime}
set -gx OpenVINO_DIR $INTEL_OPENVINO_DIR
set -gx OpenVINO_VERSION 2024.6
set -gx IE_PLUGINS_PATH ${openvinoLibDir}
if not set -q INTEL_NPU_DEVICE
  set -gx INTEL_NPU_DEVICE NPU
end

function __calnix_openvino_prepend_ldpath --argument-names value
  if test -e $value
    if set -q LD_LIBRARY_PATH
      set -l haystack :$LD_LIBRARY_PATH:
      if not string match -q "*:$value:*" $haystack
        set -gx LD_LIBRARY_PATH $value:$LD_LIBRARY_PATH
      end
    else
      set -gx LD_LIBRARY_PATH $value
    end
  end
end

function __calnix_openvino_prepend_pkgconfig --argument-names value
  if test -e $value
    if set -q PKG_CONFIG_PATH
      set -l haystack :$PKG_CONFIG_PATH:
      if not string match -q "*:$value:*" $haystack
        set -gx PKG_CONFIG_PATH $value:$PKG_CONFIG_PATH
      end
    else
      set -gx PKG_CONFIG_PATH $value
    end
  end
end

function __calnix_openvino_prepend_python --argument-names value
  if test -e $value
    if set -q PYTHONPATH
      set -l haystack :$PYTHONPATH:
      if not string match -q "*:$value:*" $haystack
        set -gx PYTHONPATH $value:$PYTHONPATH
      end
    else
      set -gx PYTHONPATH $value
    end
  end
end

__calnix_openvino_prepend_ldpath ${openvinoLibDir}
__calnix_openvino_prepend_ldpath ${openvinoTbbDir}
__calnix_openvino_prepend_ldpath ${openvinoHddlDir}
__calnix_openvino_prepend_ldpath ${levelZeroLibDir}
__calnix_openvino_prepend_ldpath ${toolchainLibDir}
__calnix_openvino_prepend_pkgconfig ${openvinoPkgConfigDir}
__calnix_openvino_prepend_python ${openvinoPythonDir}

if test -n "$HOME"
  set -gx INTEL_NPU_HOME "$HOME/.intel_npu"
  mkdir -p $INTEL_NPU_HOME
  ln -sfn ${openvinoLibDir} $INTEL_NPU_HOME/lib
  ln -sfn ${openvinoShareDir} $INTEL_NPU_HOME/share
end

functions -e __calnix_openvino_prepend_ldpath
functions -e __calnix_openvino_prepend_pkgconfig
functions -e __calnix_openvino_prepend_python
'';
    in
    {
      environment.systemPackages = [ openvinoRuntime levelZero ];
      environment.loginShellInit = mkAfter posixProfile;
      programs.fish.shellInit = mkAfter fishProfile;
    }
  );
}
