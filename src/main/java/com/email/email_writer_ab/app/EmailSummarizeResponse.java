package com.email.email_writer_ab.app;

public class EmailSummarizeResponse {

    private String summary;

    public EmailSummarizeResponse() {
    }

    public EmailSummarizeResponse(String summary) {
        this.summary = summary;
    }

    public String getSummary() {
        return summary;
    }

    public void setSummary(String summary) {
        this.summary = summary;
    }
}
