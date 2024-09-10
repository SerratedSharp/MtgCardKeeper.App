
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
   File {name: 'Jada.jpg', lastModified: 1703653043646, lastModifiedDate: Tue Dec 26 2023 23:57:23 GMT-0500 (Eastern Standard Time), webkitRelativePath: '', size: 205748, …}
lastModified 1703653043646
lastModifiedDate Tue Dec 26 2023 23:57:23 GMT-0500 (Eastern Standard Time) {}
name "Jada.jpg"
size 205748
type "image/jpeg"
webkitRelativePath:""
   */




})(BrowserApiShim);

export { BrowserApiShim }; 