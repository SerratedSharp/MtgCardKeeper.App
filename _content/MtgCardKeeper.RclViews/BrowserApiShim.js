
let BrowserApiShim = globalThis.BrowserApiShim || {};// Conditionally create namespace
(function (BrowserApiShim) {




    let FileReaderNS = BrowserApiShim.Element || {};// create child namespace
    BrowserApiShim.FileReader = FileReaderNS; // add to parent namespace

    //let Document = BrowserApiShim.Document || {};// create child namespace
    //BrowserApiShim.Document = Document; // add to parent namespace

    FileReaderNS.CreateFileReader = () => new FileReader();
    // CONSIDER: A different approach using OS file picker: https://stackoverflow.com/a/73635207/84206

    // Takes a File object, and returns a promise that can be awaited to return the contents of the File as a string
    FileReaderNS.ReadFileAsync = (file, onProgress) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.addEventListener('load', () => resolve(reader.result));
            reader.addEventListener('error', (e) => reject(new Error('Reading file failed: ' + e.target.error.message)));
            reader.addEventListener('abort', () => reject(new Error('Reading file cancelled.')));
            reader.addEventListener('progress', (e) => {
                if (onProgress && e.lengthComputable) {
                    onProgress(e.loaded, e.total);
                }
            });
            reader.readAsText(file);
        });
    };

    // Expects a File as input:
   /*
   File {name: 'Jada.jpg', lastModified: 1703653043646, lastModifiedDate: Tue Dec 26 2023 23:57:23 GMT-0500 (Eastern Standard Time), webkitRelativePath: '', size: 205748, �}
lastModified 1703653043646
lastModifiedDate Tue Dec 26 2023 23:57:23 GMT-0500 (Eastern Standard Time) {}
name "Jada.jpg"
size 205748
type "image/jpeg"
webkitRelativePath:""
   */

    const FileSystemAccess = BrowserApiShim.FileSystemAccess || {};
    BrowserApiShim.FileSystemAccess = FileSystemAccess;

    const BackupFileSuffix = '.mtgk.gz';
    const BackupFilePrefix = 'mtgk-backup-';

    FileSystemAccess.isDirectoryPickerSupported = () => !!window.showDirectoryPicker;

    FileSystemAccess.selectBackupFolder = async () => {
        if (!window.showDirectoryPicker) {
            throw new Error('Directory picker not supported');
        }
        try {
            return await window.showDirectoryPicker();
        } catch (error) {
            if (error.name === 'AbortError') {
                return null;
            }
            throw error;
        }
    };

    FileSystemAccess.getFolderName = async (directoryHandle) => {
        if (!directoryHandle || !directoryHandle.name) {
            return 'Unknown';
        }
        return directoryHandle.name;
    };

    FileSystemAccess.enumerateBackupFiles = async (directoryHandle) => {
        const backupFiles = [];
        for await (const entry of directoryHandle.values()) {
            if (entry.kind === 'file'
                && entry.name.startsWith(BackupFilePrefix)
                && entry.name.endsWith(BackupFileSuffix)) {
                backupFiles.push(entry.name);
            }
        }
        backupFiles.sort((a, b) => b.localeCompare(a));
        return backupFiles;
    };

    FileSystemAccess.readFileFromDirectory = async (directoryHandle, filename) => {
        const fileHandle = await directoryHandle.getFileHandle(filename);
        const file = await fileHandle.getFile();
        const buffer = await file.arrayBuffer();
        return new Uint8Array(buffer);
    };

    FileSystemAccess.writeFileToDirectory = async (directoryHandle, filename, bytes) => {
        const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        const payload = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        await writable.write(payload);
        await writable.close();
        return true;
    };

    globalThis.BrowserApiShim = BrowserApiShim;

})(BrowserApiShim);

export function getFileSystemAccess() {
    return BrowserApiShim.FileSystemAccess;
}

export { BrowserApiShim }; 