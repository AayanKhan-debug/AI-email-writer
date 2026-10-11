package com.email.email_writer_ab.app;

import lombok.Data;

@Data
public class EmailRequest {
    private String emailContent;
    private String tone;
}