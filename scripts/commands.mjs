// npm and npm's bun are command shims on Windows (npm.cmd, bun.cmd), which a spawn without a shell cannot start. npm is
// run as its own JavaScript entry under this Node, and bun as the executable its shim names, on every platform.
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

// The leader starts suspended: no descendant can escape the Job before it owns the command.
// PowerShell supplies the native Windows APIs without a compiled addon or an installed helper.
const windowsOwnerScript = String.raw`
param([string]$PipeName)
$ErrorActionPreference = 'Stop'
$pipe = $null
$reader = $null
try {
  $pipe = [System.IO.Pipes.NamedPipeClientStream]::new('.', $PipeName, [System.IO.Pipes.PipeDirection]::InOut, [System.IO.Pipes.PipeOptions]::Asynchronous)
  $pipe.Connect(1000)
  $reader = [System.IO.StreamReader]::new($pipe, [System.Text.UTF8Encoding]::new($false))
  $config = $reader.ReadLine() | ConvertFrom-Json
  Add-Type -ReferencedAssemblies System.dll, System.Core.dll -WarningAction SilentlyContinue -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class OwnedCommand {
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {
    public IntPtr process, thread;
    public uint processId, threadId;
  }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct StartupInfo {
    public uint size;
    public string reserved, desktop, title;
    public uint x, y, width, height, columns, rows, fill, flags;
    public ushort show, reservedSize;
    public IntPtr reservedBytes, input, output, error;
  }
  [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
    public long processTime, jobTime;
    public uint flags;
    public UIntPtr minimumWorkingSet, maximumWorkingSet;
    public uint activeProcessLimit;
    public UIntPtr affinity;
    public uint priority, scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters {
    public ulong readOps, writeOps, otherOps, readBytes, writeBytes, otherBytes;
  }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
    public BasicLimits basic;
    public IoCounters io;
    public UIntPtr processMemory, jobMemory, peakProcessMemory, peakJobMemory;
  }
  [StructLayout(LayoutKind.Sequential)] struct Accounting {
    public long userTime, kernelTime, periodUserTime, periodKernelTime;
    public uint pageFaults, totalProcesses, activeProcesses, terminatedProcesses;
  }
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateJobObjectW(IntPtr attributes, IntPtr name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits limits, uint length);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, out Accounting accounting, uint length, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string directory, ref StartupInfo startup, out ProcessInfo process);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr GetStdHandle(int handle);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess, out IntPtr target, uint access, bool inherit, uint options);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

  static void Check(bool success, string operation) {
    if (!success) throw new Win32Exception(Marshal.GetLastWin32Error(), operation);
  }
  static string Quote(string argument) {
    var result = new StringBuilder("\"");
    int slashes = 0;
    foreach (char character in argument) {
      if (character == '\\') { slashes++; continue; }
      result.Append('\\', slashes * (character == '"' ? 2 : 1));
      if (character == '"') result.Append('\\');
      result.Append(character);
      slashes = 0;
    }
    return result.Append('\\', slashes * 2).Append('"').ToString();
  }
  static void Retire(IntPtr job) {
    // Keep ownership, including on an API error, until Windows confirms no member remains.
    bool reported = false;
    for (;;) {
      Accounting accounting;
      if (TerminateJobObject(job, 1) && QueryInformationJobObject(job, 1, out accounting, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero)) {
        if (accounting.activeProcesses == 0) return;
      } else if (!reported) {
        Console.Error.WriteLine(new Win32Exception(Marshal.GetLastWin32Error(), "Retire Windows command job"));
        reported = true;
      }
      Thread.Sleep(20);
    }
  }
  public static int Run(string executable, string[] arguments, string environment, string directory, TextReader control) {
    IntPtr job = IntPtr.Zero, environmentBlock = IntPtr.Zero;
    var handles = new IntPtr[3];
    var process = new ProcessInfo();
    bool assigned = false;
    try {
      var cancellation = new char[1];
      var cancelled = control.ReadAsync(cancellation, 0, 1);
      job = CreateJobObjectW(IntPtr.Zero, IntPtr.Zero);
      Check(job != IntPtr.Zero, "Create Windows command job");
      var limits = new ExtendedLimits();
      limits.basic.flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
      Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))), "Set Windows command job limits");
      for (int index = 0; index < handles.Length; index++) {
        Check(DuplicateHandle(GetCurrentProcess(), GetStdHandle(-10 - index), GetCurrentProcess(), out handles[index], 0, true, 2), "Inherit command standard handle");
      }
      var startup = new StartupInfo();
      startup.size = (uint)Marshal.SizeOf(typeof(StartupInfo));
      startup.flags = 0x100; // STARTF_USESTDHANDLES
      startup.input = handles[0]; startup.output = handles[1]; startup.error = handles[2];
      var commandLine = new StringBuilder(Quote(executable));
      foreach (string argument in arguments) commandLine.Append(' ').Append(Quote(argument));
      environmentBlock = Marshal.StringToHGlobalUni(environment);
      Check(CreateProcessW(executable, commandLine, IntPtr.Zero, IntPtr.Zero, true, 0x08000404, environmentBlock, directory, ref startup, out process), "Create suspended command");
      Check(AssignProcessToJobObject(job, process.process), "Assign command to Windows job");
      assigned = true;
      Check(ResumeThread(process.thread) != UInt32.MaxValue, "Resume owned command");
      for (;;) {
        uint waited = WaitForSingleObject(process.process, 20);
        if (waited == 0) {
          uint code;
          Check(GetExitCodeProcess(process.process, out code), "Read command exit status");
          return unchecked((int)code);
        }
        Check(waited != UInt32.MaxValue, "Wait for owned command");
        // EOF also cancels: an owner that has died cannot leave writers behind.
        if (cancelled.IsCompleted) return cancelled.GetAwaiter().GetResult() != 0 && cancellation[0] == 'I' ? 130 : 143;
      }
    } finally {
      if (!assigned && process.process != IntPtr.Zero) {
        bool reported = false;
        while (WaitForSingleObject(process.process, 0) != 0) {
          if (!TerminateProcess(process.process, 1) && !reported) {
            Console.Error.WriteLine(new Win32Exception(Marshal.GetLastWin32Error(), "Terminate unassigned suspended command"));
            reported = true;
          }
          Thread.Sleep(20);
        }
      }
      if (job != IntPtr.Zero) { Retire(job); CloseHandle(job); }
      if (process.thread != IntPtr.Zero) CloseHandle(process.thread);
      if (process.process != IntPtr.Zero) CloseHandle(process.process);
      foreach (IntPtr handle in handles) if (handle != IntPtr.Zero) CloseHandle(handle);
      if (environmentBlock != IntPtr.Zero) Marshal.FreeHGlobal(environmentBlock);
    }
  }
}
'@
  $executable = (Get-Command -Name $config.command -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  try {
    $status = [OwnedCommand]::Run($executable, [string[]]$config.args, $config.environment, $config.directory, $reader)
  } catch {
    [Console]::Error.WriteLine($_.Exception.ToString())
    $status = 1
  }
  $message = [Text.Encoding]::ASCII.GetBytes('retired')
  $pipe.Write($message, 0, $message.Length)
  $pipe.Flush()
  exit $status
} catch {
  [Console]::Error.WriteLine($_.Exception.ToString())
  exit 1
} finally {
  if ($null -ne $reader) { $reader.Dispose() }
  if ($null -ne $pipe) { $pipe.Dispose() }
}
`;

async function prepareWindowsCommand(command, args, options) {
  const directory = mkdtempSync(join(tmpdir(), 'world-command-'));
  const pipe = `world-command-${process.pid}-${directory.split(/[\\/]/).at(-1)}`;
  const variables = options.env ?? process.env;
  const environmentEntries = new Map();
  for (const key of Object.keys(variables).sort()) {
    if (variables[key] !== undefined && !environmentEntries.has(key.toUpperCase())) environmentEntries.set(key.toUpperCase(), `${key}=${variables[key]}`);
  }
  const environment = [...environmentEntries].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, value]) => value).join('\0') + '\0\0';
  let connection, requested, retired = '', controlClosed;
  const server = createServer((socket) => {
    connection = socket;
    server.close();
    controlClosed = new Promise((resolve) => { socket.once('close', resolve); });
    socket.on('data', (data) => { retired += data.toString('ascii'); });
    socket.on('error', () => {}); // A missing retirement confirmation is reported after the owner closes.
    socket.write(JSON.stringify({ command, args, environment, directory: resolve(options.cwd ?? process.cwd()) }) + '\n');
    if (requested) socket.write(requested);
  });
  try {
    const script = join(directory, 'owner.ps1');
    writeFileSync(script, windowsOwnerScript);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(`\\\\.\\pipe\\${pipe}`, resolve);
    });
    return {
      start() {
        return spawn(join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
          ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-PipeName', pipe],
          { ...options, windowsHide: true });
      },
      stop(status) {
        if (requested) return;
        requested = status === 130 ? 'I' : 'T';
        connection?.write(requested);
      },
      async finish() {
        await controlClosed;
        if (retired !== 'retired') throw new Error('Windows command owner exited without confirming its job is empty');
      },
      dispose() {
        server.close();
        connection?.destroy();
        rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (cause) {
    server.close();
    rmSync(directory, { recursive: true, force: true });
    throw cause;
  }
}

/** The program and arguments that run `npm <args>` without a shell. */
export function npmCommand(args) {
  const beside = [join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  const cli = [process.env.npm_execpath, ...beside].find((path) => path && /npm-cli\.js$/.test(path) && existsSync(path));
  return cli ? { command: process.execPath, args: [cli, ...args] } : { command: 'npm', args };
}

/** Bun's own executable: on Windows asked of its shim once, through the shell, with no argument of the caller's. */
export function bunExecutable() {
  if (process.platform !== 'win32') return 'bun';
  const asked = spawnSync('bun', ['-e', '"console.log(process.execPath)"'], { shell: true, encoding: 'utf8', windowsHide: true });
  return asked.status === 0 && asked.stdout.trim() ? asked.stdout.trim() : 'bun';
}

/** A qualification command owns its descendants until every writer has ended. */
export async function runOwnedCommand(command, args, options) {
  const { terminationGraceMs, ...spawnOptions } = options;
  const grouped = process.platform !== 'win32';
  let owner, child, stdout = '', stderr = '', error, interrupted = 0, cancellation;
  const endGroup = (signal) => {
    if (!child?.pid) return;
    if (owner) { owner.stop(interrupted || 143); return; }
    try { process.kill(-child.pid, signal); }
    catch (cause) { if (cause.code !== 'ESRCH') throw cause; }
  };
  const interrupt = (signal) => {
    if (interrupted) return;
    interrupted = signal === 'SIGINT' ? 130 : 143;
    // A stopped supervisor must resume before it can forward cancellation and finish cleanup.
    if (grouped) endGroup('SIGCONT');
    endGroup(signal);
    // Installs have a forced cancellation bound; their supervising steps wait for that cleanup.
    if (grouped && terminationGraceMs !== undefined) cancellation = setTimeout(() => endGroup('SIGKILL'), terminationGraceMs);
  };
  const terminate = () => interrupt('SIGTERM'), cancel = () => interrupt('SIGINT');
  process.on('SIGTERM', terminate);
  process.on('SIGINT', cancel);
  const collect = (stream, write) => {
    let size = 0;
    stream?.setEncoding('utf8');
    stream?.on('data', (text) => {
      size += Buffer.byteLength(text);
      if (size <= 32 * 1024 * 1024) write(text);
      else {
        error = new Error('Qualification command output exceeded 32 MiB');
        interrupt('SIGTERM');
      }
    });
  };
  try {
    if (!grouped) owner = await prepareWindowsCommand(command, args, spawnOptions);
    child = owner ? owner.start() : spawn(command, args, { ...spawnOptions, detached: true, windowsHide: true });
    if (interrupted) endGroup(interrupted === 130 ? 'SIGINT' : 'SIGTERM');
    collect(child.stdout, (text) => { stdout += text; });
    collect(child.stderr, (text) => { stderr += text; });
    const closed = await /** @type {Promise<{ exitCode: number | null, signal: NodeJS.Signals | null }>} */ (new Promise((resolve) => {
      child.once('error', (cause) => { error = cause; });
      // close waits for inherited pipes too, so end orphan writers as soon as their parent exits.
      child.once('exit', () => { if (grouped) endGroup('SIGKILL'); });
      child.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
    }));
    if (owner) {
      try { await owner.finish(); }
      catch (cause) { error ??= cause; }
    }
    if (grouped && child.pid) {
      // An exited npm parent is not a finished step while a descendant still writes.
      endGroup('SIGKILL');
      for (;;) {
        try { process.kill(-child.pid, 0); }
        catch (cause) { if (cause.code === 'ESRCH') break; throw cause; }
        await delay(20);
      }
    }
    return { status: interrupted || closed.exitCode, exitCode: closed.exitCode, signal: closed.signal, stdout, stderr, error };
  } finally {
    clearTimeout(cancellation);
    process.off('SIGTERM', terminate);
    process.off('SIGINT', cancel);
    owner?.dispose();
  }
}
