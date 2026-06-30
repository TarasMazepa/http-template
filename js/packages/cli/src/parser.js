function parseArgs(argv) {
 
  const args = argv.slice(2);
  const command = args[0];
  const file = args[1];

  const flags = {};

  for (let i=2, len=args.length; i<len; i++) {
    const arg = args[i];

    if(!arg.startsWith('--')) {
      continue;
    }
    const flagName = arg.slice(2);
    const nextValue = args[i + 1];

    if(!nextValue || nextValue.startsWith('--')) {
      flags[flagName] = true;
    }else {
      flags[flagName] = nextValue;
      i++;
    }

  }
  
  return { command, file, flags };

}

module.exports = { parseArgs };
