"use strict";
/*---------------------------------------------------------------------------------------------
 * AI Task Pipeline - Type Definitions
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.HIGH_RISK_OPERATIONS = exports.POOL_COLORS = exports.POOL_LABELS = exports.TaskStatus = void 0;
var TaskStatus;
(function (TaskStatus) {
    TaskStatus["Todo"] = "todo";
    TaskStatus["InProgress"] = "inProgress";
    TaskStatus["PendingReview"] = "pendingReview";
    TaskStatus["Completed"] = "completed";
    TaskStatus["Terminated"] = "terminated";
})(TaskStatus || (exports.TaskStatus = TaskStatus = {}));
exports.POOL_LABELS = {
    [TaskStatus.Todo]: '待处理 (To Do)',
    [TaskStatus.InProgress]: '处理中 (In Progress)',
    [TaskStatus.PendingReview]: '待审核 (Pending Review)',
    [TaskStatus.Completed]: '已完成 (Completed)',
    [TaskStatus.Terminated]: '已终止 (Terminated)',
};
exports.POOL_COLORS = {
    [TaskStatus.Todo]: '#858585',
    [TaskStatus.InProgress]: '#007acc',
    [TaskStatus.PendingReview]: '#cca700',
    [TaskStatus.Completed]: '#89d185',
    [TaskStatus.Terminated]: '#f14c4c',
};
/** Operations that are considered high-risk and require user approval */
exports.HIGH_RISK_OPERATIONS = new Set([
    'runCommand',
]);
//# sourceMappingURL=types.js.map