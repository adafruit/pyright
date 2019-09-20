/*
* pythonPathUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Utility routines used to resolve various paths in python.
*/

// import * as fs from 'fs';

import { ConfigOptions } from '../common/configOptions';
import { combinePaths, ensureTrailingDirectorySeparator, getDirectoryPath,
    getFileSystemEntries, isDirectory, normalizePath } from '../common/pathUtils';

const cachedSearchPaths: { [path: string]: string[] } = {};

export function getTypeShedFallbackPath() {
    // The entry point to the tool should have set the __rootDirectory
    // global variable to point to the directory that contains the
    // typeshed-fallback directory.
    let moduleDirectory = (global as any).__rootDirectory;
    if (moduleDirectory) {
        moduleDirectory = normalizePath(moduleDirectory);
        return combinePaths(getDirectoryPath(
            ensureTrailingDirectorySeparator(moduleDirectory)),
            'typeshed-fallback');
    }

    return undefined;
}

export function getTypeshedSubdirectory(typeshedPath: string, isStdLib: boolean) {
    return combinePaths(typeshedPath, isStdLib ? 'stdlib' : 'third_party');
}

export function findPythonSearchPaths(configOptions: ConfigOptions, venv: string | undefined,
        importFailureInfo: string[]): string[] | undefined {

    importFailureInfo.push('Finding python search paths');

    let venvPath: string | undefined;
    if (venv !== undefined) {
        if (configOptions.venvPath) {
            venvPath = combinePaths(configOptions.venvPath, venv);
        }
    } else if (configOptions.defaultVenv) {
        if (configOptions.venvPath) {
            venvPath = combinePaths(configOptions.venvPath, configOptions.defaultVenv);
        }
    }

    if (venvPath) {
        let libPath = combinePaths(venvPath, 'lib');
        if (fs.existsSync(libPath)) {
            importFailureInfo.push(`Found path '${ libPath }'; looking for site-packages`);
        } else {
            importFailureInfo.push(`Did not find '${ libPath }'; trying 'Lib' instead`);
            libPath = combinePaths(venvPath, 'Lib');
            if (fs.existsSync(libPath)) {
                importFailureInfo.push(`Found path '${ libPath }'; looking for site-packages`);
            } else {
                importFailureInfo.push(`Did not find '${ libPath }'`);
                libPath = '';
            }
        }

        if (libPath) {
            const sitePackagesPath = combinePaths(libPath, 'site-packages');
            if (fs.existsSync(sitePackagesPath)) {
                importFailureInfo.push(`Found path '${ sitePackagesPath }'`);
                return [sitePackagesPath];
            } else {
                importFailureInfo.push(`Did not find '${ sitePackagesPath }', so looking for python subdirectory`);
            }

            // We didn't find a site-packages directory directly in the lib
            // directory. Scan for a "python*" directory instead.
            const entries = getFileSystemEntries(libPath);
            for (let i = 0; i < entries.directories.length; i++) {
                const dirName = entries.directories[i];
                if (dirName.startsWith('python')) {
                    const dirPath = combinePaths(libPath, dirName, 'site-packages');
                    if (fs.existsSync(dirPath)) {
                        importFailureInfo.push(`Found path '${ dirPath }'`);
                        return [dirPath];
                    } else {
                        importFailureInfo.push(`Path '${ dirPath }' is not a valid directory`);
                    }
                }
            }
        }

        importFailureInfo.push(`Did not find site-packages. Falling back on python interpreter.`);
    }
}
