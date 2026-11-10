package com.attendify.employee

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.fragment.app.FragmentActivity
import com.attendify.employee.ui.AttendifyApp
import com.attendify.employee.ui.AttendifyTheme

class MainActivity : FragmentActivity() {
    private val viewModel: AttendifyViewModel by viewModels {
        AttendifyViewModel.factory(applicationContext)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            AttendifyTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    AttendifyApp(viewModel = viewModel)
                }
            }
        }
    }
}
