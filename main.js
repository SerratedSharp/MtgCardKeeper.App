// Licensed to the .NET Foundation under one or more agreements.
// The .NET Foundation licenses this file to you under the MIT license.

import { dotnet } from './_framework/dotnet.js'

const { setModuleImports, getAssemblyExports, getConfig } = await dotnet
    .withDiagnosticTracing(false)
    .withApplicationArgumentsFromQuery()
    .create();

setModuleImports('main.js', {
    window: {
        location: {
            href: () => globalThis.window.location.href
        }
    }
});

const config = getConfig();

const assemblyExports = await getAssemblyExports(config.mainAssemblyName); 

//const text = assemblyExports.MyClass.Greeting(); //globalThis.exports.MyClass.Greeting();
//console.log(text);

export { assemblyExports }
window.assemblyExports = assemblyExports;

//document.getElementById('out').innerHTML = text;
await dotnet.run();

