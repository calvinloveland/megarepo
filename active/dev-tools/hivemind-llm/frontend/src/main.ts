const statusBadge = document.getElementById('status-badge') as HTMLDivElement | null
const statusText = document.getElementById('status-text') as HTMLParagraphElement | null
const adapterInfo = document.getElementById('adapter-info') as HTMLParagraphElement | null
const deviceInfo = document.getElementById('device-info') as HTMLParagraphElement | null
const featureInfo = document.getElementById('feature-info') as HTMLParagraphElement | null
const logPanel = document.getElementById('log') as HTMLPreElement | null
const runButton = document.getElementById('run-test') as HTMLButtonElement | null

let device: GPUDevice | null = null
let adapter: GPUAdapter | null = null

const setStatus = (state: 'ok' | 'warn' | 'error', message: string) => {
  if (statusText) {
    statusText.textContent = message
  }
  if (statusBadge) {
    statusBadge.textContent = state === 'ok' ? 'Ready' : state === 'warn' ? 'Limited' : 'Unavailable'
    statusBadge.dataset.state = state
  }
}

const logLine = (message: string) => {
  if (!logPanel) {
    return
  }
  const timestamp = new Date().toLocaleTimeString()
  logPanel.textContent += `[${timestamp}] ${message}\n`
  logPanel.scrollTop = logPanel.scrollHeight
}

const formatAdapterInfo = (info: GPUAdapterInfo | undefined) => {
  if (!info) {
    return 'Unknown adapter'
  }
  const parts = [info.vendor, info.architecture, info.device]
    .filter((value) => value && value.length > 0)
    .join(' • ')
  return parts || info.description || 'Unknown adapter'
}

const formatFeatures = (featureSet: GPUFeatureName[]) => {
  if (featureSet.length === 0) {
    return 'No optional features reported'
  }
  return featureSet.join(', ')
}

const initWebGPU = async () => {
  if (!('gpu' in navigator)) {
    setStatus('error', 'WebGPU is not available in this browser.')
    logLine('WebGPU API missing. Try Chrome/Edge 113+ or enable chrome://flags/#enable-unsafe-webgpu')
    return
  }

  setStatus('warn', 'Requesting GPU adapter…')

  try {
    adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) {
      setStatus('error', 'No WebGPU adapter found.')
      logLine('navigator.gpu.requestAdapter returned null.')
      return
    }

    const info = adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : undefined
    if (adapterInfo) {
      adapterInfo.textContent = formatAdapterInfo(info)
    }

    device = await adapter.requestDevice()
    if (deviceInfo) {
      deviceInfo.textContent = `Limits: ${device.limits.maxStorageBufferBindingSize.toLocaleString()} bytes`
    }

    if (featureInfo) {
      featureInfo.textContent = formatFeatures(Array.from(adapter.features))
    }

    setStatus('ok', 'WebGPU is ready. Run the self-test to verify compute works.')
    logLine('WebGPU device created successfully.')

    if (runButton) {
      runButton.disabled = false
    }
  } catch (error) {
    console.error(error)
    setStatus('error', 'Failed to initialize WebGPU. See log for details.')
    logLine(`Initialization error: ${(error as Error).message}`)
  }
}

const runSelfTest = async () => {
  if (!device) {
    logLine('WebGPU device not available yet.')
    return
  }

  logLine('Running compute shader: vector add (4 values).')

  const inputA = new Float32Array([1, 2, 3, 4])
  const inputB = new Float32Array([10, 20, 30, 40])
  const output = new Float32Array(4)

  const bufferA = device.createBuffer({
    size: inputA.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(bufferA, 0, inputA)

  const bufferB = device.createBuffer({
    size: inputB.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(bufferB, 0, inputB)

  const bufferOut = device.createBuffer({
    size: output.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })

  const readBuffer = device.createBuffer({
    size: output.byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })

  const shader = `
    @group(0) @binding(0) var<storage, read> a : array<f32>;
    @group(0) @binding(1) var<storage, read> b : array<f32>;
    @group(0) @binding(2) var<storage, read_write> out : array<f32>;

    @compute @workgroup_size(4)
    fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
      let idx = gid.x;
      if (idx < 4u) {
        out[idx] = a[idx] + b[idx];
      }
    }
  `

  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ code: shader }),
      entryPoint: 'main',
    },
  })

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: bufferA } },
      { binding: 1, resource: { buffer: bufferB } },
      { binding: 2, resource: { buffer: bufferOut } },
    ],
  })

  const encoder = device.createCommandEncoder()
  const pass = encoder.beginComputePass()
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, bindGroup)
  pass.dispatchWorkgroups(1)
  pass.end()

  encoder.copyBufferToBuffer(bufferOut, 0, readBuffer, 0, output.byteLength)
  device.queue.submit([encoder.finish()])

  await readBuffer.mapAsync(GPUMapMode.READ)
  const mapped = readBuffer.getMappedRange()
  output.set(new Float32Array(mapped))
  readBuffer.unmap()

  logLine(`Self-test output: [${Array.from(output).join(', ')}]`)
  logLine('If the output is 11, 22, 33, 44 then WebGPU compute is working.')
}

if (runButton) {
  runButton.addEventListener('click', () => {
    runSelfTest().catch((error) => {
      console.error(error)
      logLine(`Self-test error: ${(error as Error).message}`)
    })
  })
}

initWebGPU().catch((error) => {
  console.error(error)
  setStatus('error', 'Unexpected initialization error.')
  logLine(`Unexpected error: ${(error as Error).message}`)
})
