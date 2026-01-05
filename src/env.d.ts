declare module '*?worker' {
    import { Worker, WorkerOptions } from 'node:worker_threads';

    class NodeWorker extends Worker {
        constructor(options?: WorkerOptions);
    }

    export default NodeWorker;
}
