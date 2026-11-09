//! A Windows job object that kills MCP server processes when Vinnie exits.
//!
//! Every stdio server is assigned to one job created with
//! KILL_ON_JOB_CLOSE. Windows closes the job handle when Vinnie's process
//! ends for any reason (including a crash), which terminates the servers and
//! everything they started (e.g. `npx` → `node`).

#![cfg(windows)]

use std::sync::OnceLock;

use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

struct Job(HANDLE);
// SAFETY: a job handle can be used from any thread.
unsafe impl Send for Job {}
unsafe impl Sync for Job {}

fn job() -> Option<&'static Job> {
    static JOB: OnceLock<Option<Job>> = OnceLock::new();
    JOB.get_or_init(|| {
        // SAFETY: plain Win32 calls; the handle is intentionally kept open for
        // the lifetime of the process (closing it would kill the servers).
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                log::warn!("could not create the MCP job object");
                return None;
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 {
                log::warn!("could not configure the MCP job object");
                return None;
            }
            Some(Job(handle))
        }
    })
    .as_ref()
}

/// Put a process into the kill-on-exit job (best effort).
pub fn assign(process: std::os::windows::io::RawHandle) {
    if let Some(job) = job() {
        // SAFETY: `process` is a live process handle owned by tokio's Child.
        let ok = unsafe { AssignProcessToJobObject(job.0, process as HANDLE) };
        if ok == 0 {
            log::warn!("could not add an MCP server to the job object");
        }
    }
}
