import { executeReactComponentStructureCommand } from "../command";

async function main(): Promise<void> {
  try {
    await executeReactComponentStructureCommand(process.argv.slice(2), {
      writeStdout: (output) => process.stdout.write(output),
    });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

void main();
