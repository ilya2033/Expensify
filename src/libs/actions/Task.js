import Onyx from 'react-native-onyx';
import lodashGet from 'lodash/get';
import _ from 'underscore';
import ONYXKEYS from '../../ONYXKEYS';
import * as API from '../API';
import * as ReportUtils from '../ReportUtils';
import * as Report from './Report';
import Navigation from '../Navigation/Navigation';
import ROUTES from '../../ROUTES';
import CONST from '../../CONST';
import DateUtils from '../DateUtils';
import * as UserUtils from '../UserUtils';
import * as PersonalDetailsUtils from '../PersonalDetailsUtils';
import * as ReportActionsUtils from '../ReportActionsUtils';

/**
 * Clears out the task info from the store
 */
function clearOutTaskInfo() {
    Onyx.set(ONYXKEYS.TASK, null);
}

/**
 * Assign a task to a user
 * Function title is createTask for consistency with the rest of the actions
 * and also because we can create a task without assigning it to anyone
 * @param {String} currentUserEmail
 * @param {Number} currentUserAccountID
 * @param {String} parentReportID
 * @param {String} title
 * @param {String} description
 * @param {String} assignee
 * @param {Number} assigneeAccountID
 *
 */

function createTaskAndNavigate(currentUserEmail, currentUserAccountID, parentReportID, title, description, assignee, assigneeAccountID = 0) {
    // Create the task report
    const optimisticTaskReport = ReportUtils.buildOptimisticTaskReport(currentUserEmail, currentUserAccountID, assigneeAccountID, parentReportID, title, description);

    // Grab the assigneeChatReportID if there is an assignee and if it's not the same as the parentReportID
    // then we create an optimistic add comment report action on the assignee's chat to notify them of the task
    const assigneeChatReportID = lodashGet(ReportUtils.getChatByParticipants([assigneeAccountID]), 'reportID');
    const taskReportID = optimisticTaskReport.reportID;
    let optimisticAssigneeAddComment;
    if (assigneeChatReportID && assigneeChatReportID !== parentReportID) {
        optimisticAssigneeAddComment = ReportUtils.buildOptimisticTaskCommentReportAction(
            taskReportID,
            title,
            assignee,
            assigneeAccountID,
            `Assigned a task to you: ${title}`,
            parentReportID,
        );
    }

    // Create the CreatedReportAction on the task
    const optimisticTaskCreatedAction = ReportUtils.buildOptimisticCreatedReportAction(optimisticTaskReport.reportID);
    const optimisticAddCommentReport = ReportUtils.buildOptimisticTaskCommentReportAction(taskReportID, title, assignee, assigneeAccountID, `Created a task: ${title}`, parentReportID);

    const currentTime = DateUtils.getDBTime();

    const lastCommentText = ReportUtils.formatReportLastMessageText(optimisticAddCommentReport.reportAction.message[0].text);

    const optimisticReport = {
        lastVisibleActionCreated: currentTime,
        lastMessageText: lastCommentText,
        lastActorEmail: currentUserEmail,
        lastActorAccountID: currentUserAccountID,
        lastReadTime: currentTime,
    };

    const optimisticData = [
        {
            onyxMethod: Onyx.METHOD.SET,
            key: `${ONYXKEYS.COLLECTION.REPORT}${optimisticTaskReport.reportID}`,
            value: {
                ...optimisticTaskReport,
                pendingFields: {
                    createChat: CONST.RED_BRICK_ROAD_PENDING_ACTION.ADD,
                },
                isOptimisticReport: true,
            },
        },
        {
            onyxMethod: Onyx.METHOD.SET,
            key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${optimisticTaskReport.reportID}`,
            value: {[optimisticTaskCreatedAction.reportActionID]: optimisticTaskCreatedAction},
        },
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${parentReportID}`,
            value: {[optimisticAddCommentReport.reportAction.reportActionID]: optimisticAddCommentReport.reportAction},
        },
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT}${parentReportID}`,
            value: optimisticReport,
        },
    ];

    const successData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT}${optimisticTaskReport.reportID}`,
            value: {
                pendingFields: {
                    createChat: null,
                },
                isOptimisticReport: false,
            },
        },
    ];

    const failureData = [
        {
            onyxMethod: Onyx.METHOD.SET,
            key: `${ONYXKEYS.COLLECTION.REPORT}${optimisticTaskReport.reportID}`,
            value: null,
        },
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${optimisticTaskReport.reportID}`,
            value: {[optimisticTaskCreatedAction.reportActionID]: {pendingAction: null}},
        },
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${parentReportID}`,
            value: {[optimisticAddCommentReport.reportAction.reportActionID]: {pendingAction: null}},
        },
    ];

    if (optimisticAssigneeAddComment) {
        const lastAssigneeCommentText = ReportUtils.formatReportLastMessageText(optimisticAssigneeAddComment.reportAction.message[0].text);

        const optimisticAssigneeReport = {
            lastVisibleActionCreated: currentTime,
            lastMessageText: lastAssigneeCommentText,
            lastActorEmail: currentUserEmail,
            lastActorAccountID: currentUserAccountID,
            lastReadTime: currentTime,
        };

        optimisticData.push(
            {
                onyxMethod: Onyx.METHOD.MERGE,
                key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${assigneeChatReportID}`,
                value: {[optimisticAssigneeAddComment.reportAction.reportActionID]: optimisticAssigneeAddComment.reportAction},
            },
            {
                onyxMethod: Onyx.METHOD.MERGE,
                key: `${ONYXKEYS.COLLECTION.REPORT}${assigneeChatReportID}`,
                value: optimisticAssigneeReport,
            },
        );

        failureData.push({
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${assigneeChatReportID}`,
            value: {[optimisticAssigneeAddComment.reportAction.reportActionID]: {pendingAction: null}},
        });
    }

    API.write(
        'CreateTask',
        {
            parentReportActionID: optimisticAddCommentReport.reportAction.reportActionID,
            parentReportID,
            taskReportID: optimisticTaskReport.reportID,
            createdTaskReportActionID: optimisticTaskCreatedAction.reportActionID,
            reportName: optimisticTaskReport.reportName,
            title: optimisticTaskReport.reportName,
            description: optimisticTaskReport.description,
            assignee,
            assigneeAccountID,
            assigneeChatReportID,
            assigneeChatReportActionID: optimisticAssigneeAddComment ? optimisticAssigneeAddComment.reportAction.reportActionID : 0,
        },
        {optimisticData, successData, failureData},
    );

    clearOutTaskInfo();

    Navigation.dismissModal(optimisticTaskReport.reportID);
}

/**
 * Completes an open task
 * @param {Object} report
 */
function completeTask(report) {
    const message = `completed task: ${ReportUtils.getReportName(report)}`;
    const completedTaskReportAction = ReportUtils.buildOptimisticTaskReportAction(report.reportID, CONST.REPORT.ACTIONS.TYPE.TASKCOMPLETED, message);

    const optimisticData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT}${report.reportID}`,
            value: {
                stateNum: CONST.REPORT.STATE_NUM.SUBMITTED,
                statusNum: CONST.REPORT.STATUS.APPROVED,
                lastMessageText: message,
                lastMessageHtml: _.escape(message),
                lastVisibleActionCreated: completedTaskReportAction.created,
                lastActorEmail: completedTaskReportAction.actorEmail,
                lastActorAccountID: completedTaskReportAction.actorAccountID,
                lastReadTime: completedTaskReportAction.created,
            },
        },

        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${report.reportID}`,
            value: {[completedTaskReportAction.reportActionID]: completedTaskReportAction},
        },
    ];

    const successData = [];
    const failureData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT}${report.reportID}`,
            value: {
                stateNum: report.stateNum,
                statusNum: report.statusNum,
                lastMessageText: report.lastMessageText,
                lastMessageHtml: report.lastMessageHtml,
                lastVisibleActionCreated: report.lastVisibleActionCreated,
                lastActorEmail: report.lastActorEmail,
                lastActorAccountID: report.lastActorAccountID,
                lastReadTime: report.lastReadTime,
            },
        },
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${report.reportID}`,
            value: {[completedTaskReportAction.reportActionID]: {pendingAction: null}},
        },
    ];

    API.write(
        'CompleteTask',
        {
            taskReportID: report.reportID,
            completedTaskReportActionID: completedTaskReportAction.reportActionID,
        },
        {optimisticData, successData, failureData},
    );
}

/**
 * Reopens a closed task
 * @param {Object} report
 */
function reopenTask(report) {
    const message = `reopened task: ${ReportUtils.getReportName(report)}`;
    const reopenedTaskReportAction = ReportUtils.buildOptimisticTaskReportAction(report.reportID, CONST.REPORT.ACTIONS.TYPE.TASKREOPENED, message);

    const optimisticData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT}${report.reportID}`,
            value: {
                stateNum: CONST.REPORT.STATE_NUM.OPEN,
                statusNum: CONST.REPORT.STATUS.OPEN,
                lastMessageText: message,
                lastMessageHtml: _.escape(message),
                lastVisibleActionCreated: reopenedTaskReportAction.created,
                lastActorEmail: reopenedTaskReportAction.actorEmail,
                lastActorAccountID: reopenedTaskReportAction.actorAccountID,
                lastReadTime: reopenedTaskReportAction.created,
            },
        },
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${report.reportID}`,
            value: {[reopenedTaskReportAction.reportActionID]: reopenedTaskReportAction},
        },
    ];

    const successData = [];
    const failureData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT}${report.reportID}`,
            value: {
                stateNum: report.stateNum,
                statusNum: report.statusNum,
                lastMessageText: report.lastMessageText,
                lastMessageHtml: report.lastMessageHtml,
                lastVisibleActionCreated: report.lastVisibleActionCreated,
                lastActorEmail: report.lastActorEmail,
                lastActorAccountID: report.lastActorAccountID,
                lastReadTime: report.lastReadTime,
            },
        },
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${report.reportID}`,
            value: {[reopenedTaskReportAction.reportActionID]: {pendingAction: null}},
        },
    ];

    API.write(
        'ReopenTask',
        {
            taskReportID: report.reportID,
            reopenedTaskReportActionID: reopenedTaskReportAction.reportActionID,
        },
        {optimisticData, successData, failureData},
    );
}

/**
 * @param {Object} report
 * @param {string} ownerEmail
 * @param {Number} ownerAccountID
 * @param {Object} editedTask
 * @param {String} editedTask.title
 * @param {String} editedTask.description
 * @param {String} editedTask.assignee
 * @param {Number} editedTask.assigneeAccountID
 */
function editTaskAndNavigate(report, ownerEmail, ownerAccountID, {title, description, assignee, assigneeAccountID = 0}) {
    // Create the EditedReportAction on the task
    const editTaskReportAction = ReportUtils.buildOptimisticEditedTaskReportAction(ownerEmail);

    // Sometimes title or description is undefined, so we need to check for that, and we provide it to multiple functions
    const reportName = (title || report.reportName).trim();

    // Description can be unset, so we default to an empty string if so
    const reportDescription = (!_.isUndefined(description) ? description : lodashGet(report, 'description', '')).trim();

    // If we make a change to the assignee, we want to add a comment to the assignee's chat
    let optimisticAssigneeAddComment;
    let assigneeChatReportID;
    if (assigneeAccountID && assigneeAccountID !== report.managerID && assigneeAccountID !== ownerAccountID) {
        assigneeChatReportID = ReportUtils.getChatByParticipants([assigneeAccountID]).reportID;

        if (assigneeChatReportID !== report.parentReportID.toString()) {
            optimisticAssigneeAddComment = ReportUtils.buildOptimisticTaskCommentReportAction(
                report.reportID,
                reportName,
                assignee,
                assigneeAccountID,
                `Assigned a task to you: ${reportName}`,
            );
        }
    }

    const optimisticData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${report.reportID}`,
            value: {[editTaskReportAction.reportActionID]: editTaskReportAction},
        },
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT}${report.reportID}`,
            value: {
                reportName,
                description: reportDescription,
                managerID: assigneeAccountID || report.managerID,
            },
        },
    ];
    const successData = [];
    const failureData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${report.reportID}`,
            value: {[editTaskReportAction.reportActionID]: {pendingAction: null}},
        },
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT}${report.reportID}`,
            value: {reportName: report.reportName, description: report.description, assignee: report.managerEmail, assigneeAccountID: report.managerID},
        },
    ];

    if (optimisticAssigneeAddComment) {
        const currentTime = DateUtils.getDBTime();
        const lastAssigneeCommentText = ReportUtils.formatReportLastMessageText(optimisticAssigneeAddComment.reportAction.message[0].text);

        const optimisticAssigneeReport = {
            lastVisibleActionCreated: currentTime,
            lastMessageText: lastAssigneeCommentText,
            lastActorAccountID: ownerAccountID,
            lastReadTime: currentTime,
        };

        optimisticData.push(
            {
                onyxMethod: Onyx.METHOD.MERGE,
                key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${assigneeChatReportID}`,
                value: {[optimisticAssigneeAddComment.reportAction.reportActionID]: optimisticAssigneeAddComment.reportAction},
            },
            {
                onyxMethod: Onyx.METHOD.MERGE,
                key: `${ONYXKEYS.COLLECTION.REPORT}${assigneeChatReportID}`,
                value: optimisticAssigneeReport,
            },
        );

        failureData.push({
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${assigneeChatReportID}`,
            value: {[optimisticAssigneeAddComment.reportAction.reportActionID]: {pendingAction: null}},
        });
    }

    API.write(
        'EditTask',
        {
            taskReportID: report.reportID,
            title: reportName,
            description: reportDescription,
            assignee: assignee || report.managerEmail,
            assigneeAccountID: assigneeAccountID || report.managerID,
            editedTaskReportActionID: editTaskReportAction.reportActionID,
            assigneeChatReportActionID: optimisticAssigneeAddComment ? optimisticAssigneeAddComment.reportAction.reportActionID : 0,
        },
        {optimisticData, successData, failureData},
    );

    Navigation.dismissModal(report.reportID);
}

/**
 * Sets the report info for the task being viewed
 *
 * @param {Object} report
 */
function setTaskReport(report) {
    Onyx.merge(ONYXKEYS.TASK, {report});
}

/**
 * Sets the title and description values for the task
 * @param {string} title
 * @param {string} description
 */
function setDetailsValue(title, description) {
    // This is only needed for creation of a new task and so it should only be stored locally
    Onyx.merge(ONYXKEYS.TASK, {title: title.trim(), description: description.trim()});
}

/**
 * Sets the title value for the task
 * @param {string} title
 */
function setTitleValue(title) {
    Onyx.merge(ONYXKEYS.TASK, {title: title.trim()});
}

/**
 * Sets the description value for the task
 * @param {string} description
 */
function setDescriptionValue(description) {
    Onyx.merge(ONYXKEYS.TASK, {description: description.trim()});
}

/**
 * Sets the shareDestination value for the task
 * @param {string} shareDestination
 */
function setShareDestinationValue(shareDestination) {
    // This is only needed for creation of a new task and so it should only be stored locally
    Onyx.merge(ONYXKEYS.TASK, {shareDestination});
}

/**
 * Auto-assign participant when creating a task in a DM
 * @param {String} reportID
 */

function setAssigneeValueWithParentReportID(reportID) {
    const report = ReportUtils.getReport(reportID);
    const isDefault = !(ReportUtils.isChatRoom(report) || ReportUtils.isPolicyExpenseChat(report));
    const participants = lodashGet(report, 'participants', []);
    const hasMultipleParticipants = participants.length > 1;
    if (!isDefault || hasMultipleParticipants || report.parentReportID) {
        return;
    }

    Onyx.merge(ONYXKEYS.TASK, {assignee: participants[0]});
}

/**
 * Sets the assignee value for the task and checks for an existing chat with the assignee
 * If there is no existing chat, it creates an optimistic chat report
 * It also sets the shareDestination as that chat report if a share destination isn't already set
 * @param {string} assignee
 * @param {Number} assigneeAccountID
 * @param {string} shareDestination
 * @param {boolean} isCurrentUser
 */

function setAssigneeValue(assignee, assigneeAccountID, shareDestination, isCurrentUser = false) {
    let newAssigneeAccountID = Number(assigneeAccountID);

    // Generate optimistic accountID if this is a brand new user account that hasn't been created yet
    if (!newAssigneeAccountID) {
        newAssigneeAccountID = UserUtils.generateAccountID();
    }
    if (!isCurrentUser) {
        let newChat = {};
        const chat = ReportUtils.getChatByParticipants([newAssigneeAccountID]);
        if (!chat) {
            newChat = ReportUtils.buildOptimisticChatReport([newAssigneeAccountID]);
        }
        const reportID = chat ? chat.reportID : newChat.reportID;

        if (!shareDestination) {
            setShareDestinationValue(reportID);
        }

        Report.openReport(reportID, [assignee], newChat);
    }

    // This is only needed for creation of a new task and so it should only be stored locally
    Onyx.merge(ONYXKEYS.TASK, {assignee, assigneeAccountID: newAssigneeAccountID});
}

/**
 * Sets the parentReportID value for the task
 * @param {string} parentReportID
 */
function setParentReportID(parentReportID) {
    // This is only needed for creation of a new task and so it should only be stored locally
    Onyx.merge(ONYXKEYS.TASK, {parentReportID});
}

/**
 * Clears out the task info from the store and navigates to the NewTaskDetails page
 * @param {string} reportID
 */
function clearOutTaskInfoAndNavigate(reportID) {
    clearOutTaskInfo();
    setParentReportID(reportID);
    Navigation.navigate(ROUTES.NEW_TASK_DETAILS);
}

/**
 * Get the assignee data
 *
 * @param {Object} details
 * @returns {Object}
 */
function getAssignee(details) {
    if (!details) {
        return {
            icons: [],
            displayName: '',
            subtitle: '',
        };
    }
    const source = UserUtils.getAvatar(lodashGet(details, 'avatar', ''), lodashGet(details, 'accountID', -1));
    return {
        icons: [{source, type: 'avatar', name: details.login}],
        displayName: details.displayName,
        subtitle: details.login,
    };
}

/**
 * Get the share destination data
 * @param {Object} reportID
 * @param {Object} reports
 * @param {Object} personalDetails
 * @returns {Object}
 * */
function getShareDestination(reportID, reports, personalDetails) {
    const report = lodashGet(reports, `report_${reportID}`, {});
    return {
        icons: ReportUtils.getIcons(report, personalDetails),
        displayName: ReportUtils.getReportName(report),
        subtitle: ReportUtils.getChatRoomSubtitle(report),
    };
}

/**
 * Cancels a task by setting the report state to SUBMITTED and status to CLOSED
 * @param {Object} report
 */
function cancelTask(report) {
    const message = `canceled task: ${ReportUtils.getReportName(report)}`;
    const optimisticCancelReportAction = ReportUtils.buildOptimisticTaskReportAction(report.reportID, CONST.REPORT.ACTIONS.TYPE.TASKCANCELED, message);
    const optimisticReportActionID = optimisticCancelReportAction.reportActionID;

    const optimisticData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT}${report.reportID}`,
            value: {
                stateNum: CONST.REPORT.STATE_NUM.SUBMITTED,
                statusNum: CONST.REPORT.STATUS.CLOSED,
            },
        },
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT}${report.reportID}`,
            value: {
                lastVisibleActionCreated: optimisticCancelReportAction.created,
                lastMessageText: message,
                lastMessageHtml: _.escape(message),
                lastActorEmail: optimisticCancelReportAction.actorEmail,
                lastActorAccountID: optimisticCancelReportAction.actorAccountID,
            },
        },
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${report.reportID}`,
            value: {
                [optimisticReportActionID]: optimisticCancelReportAction,
            },
        },
    ];

    const failureData = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT}${report.reportID}`,
            value: {
                stateNum: report.stateNum,
                statusNum: report.statusNum,
                lastMessageText: report.lastMessageText,
                lastMessageHtml: report.lastMessageHtml,
                lastVisibleActionCreated: report.lastVisibleActionCreated,
                lastActorEmail: report.lastActorEmail,
                lastActorAccountID: report.lastActorAccountID,
            },
        },
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${report.reportID}`,
            value: {
                [optimisticReportActionID]: null,
            },
        },
    ];

    API.write(
        'CancelTask',
        {
            taskReportID: report.reportID,
            optimisticReportActionID,
        },
        {optimisticData, failureData},
    );
}

function isTaskCanceled(taskReport) {
    return taskReport.stateNum === CONST.REPORT.STATE_NUM.SUBMITTED && taskReport.statusNum === CONST.REPORT.STATUS.CLOSED;
}

/**
 * Closes the current open task modal and clears out the task info from the store.
 */
function dismissModalAndClearOutTaskInfo() {
    Navigation.dismissModal();
    clearOutTaskInfo();
}

/**
 * Returns Task assignee accountID
 *
 * @param {Object} taskReport
 * @returns {Number|null}
 */
function getTaskAssigneeAccountID(taskReport) {
    if (!taskReport) {
        return null;
    }

    if (taskReport.managerID) {
        return taskReport.managerID;
    }

    const reportAction = ReportActionsUtils.getParentReportAction(taskReport);
    const childManagerEmail = lodashGet(reportAction, 'childManagerEmail', '');
    return PersonalDetailsUtils.getAccountIDsByLogins([childManagerEmail])[0];
}

/**
 * Returns Task owner accountID
 *
 * @param {Object} taskReport
 * @returns {Number|null}
 */
function getTaskOwnerAccountID(taskReport) {
    return lodashGet(taskReport, 'ownerAccountID', null);
}

/**
 * Check if current user is either task assignee or task owner
 *
 * @param {Object} taskReport
 * @param {Number} sessionAccountID
 * @returns {Boolean}
 */
function isTaskAssigneeOrTaskOwner(taskReport, sessionAccountID) {
    return sessionAccountID === getTaskOwnerAccountID(taskReport) || sessionAccountID === getTaskAssigneeAccountID(taskReport);
}

export {
    createTaskAndNavigate,
    editTaskAndNavigate,
    setTitleValue,
    setDescriptionValue,
    setTaskReport,
    setDetailsValue,
    setAssigneeValue,
    setAssigneeValueWithParentReportID,
    setShareDestinationValue,
    clearOutTaskInfo,
    reopenTask,
    completeTask,
    clearOutTaskInfoAndNavigate,
    getAssignee,
    getShareDestination,
    cancelTask,
    isTaskCanceled,
    dismissModalAndClearOutTaskInfo,
    getTaskAssigneeAccountID,
    isTaskAssigneeOrTaskOwner,
};
